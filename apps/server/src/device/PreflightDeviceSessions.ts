import * as NodeCrypto from "node:crypto";
import {
  DeviceOperationError,
  LOCAL_DEVICE_HOST_ID,
  type DeviceError,
  type DeviceServiceState,
  type DevicePreflightBinding,
  type DeviceSession,
  type DeviceHostId,
  type DeviceId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import type { DeviceService } from "./DeviceService.ts";
import * as PreflightDeviceSource from "./PreflightDeviceSource.ts";
import * as AgentDeviceTarget from "./AgentDeviceTarget.ts";

const Configuration = Schema.Struct({
  baseUrl: Schema.String,
  token: Schema.String.check(Schema.isMinLength(1)),
  hostIdentities: Schema.Record(Schema.String, Schema.String.check(Schema.isMinLength(1))),
});
type Configuration = typeof Configuration.Type;
const decodeConfiguration = Schema.decodeUnknownEffect(Configuration);
const decodeHostIdentities = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)),
);
export class PreflightDeviceConfiguration extends Context.Service<
  PreflightDeviceConfiguration,
  {
    readonly configuration: Configuration | null;
  }
>()("t3/device/PreflightDeviceSessions/PreflightDeviceConfiguration") {}

const failed = () =>
  new DeviceOperationError({
    operation: "Preflight device session",
    reason: "request_failed",
    cause: new Error(
      "Preflight device lease or source verification failed. Reopen the bound session before controlling the device.",
    ),
  });

export const configurationLayer = Layer.effect(
  PreflightDeviceConfiguration,
  Effect.gen(function* () {
    const baseUrl = process.env.T3_PREFLIGHT_URL;
    const token = process.env.T3_PREFLIGHT_TOKEN;
    const hostIdentities = process.env.T3_PREFLIGHT_HOST_IDENTITIES;
    if (!baseUrl && !token && !hostIdentities)
      return PreflightDeviceConfiguration.of({ configuration: null });
    const parsed = yield* decodeHostIdentities(hostIdentities ?? "").pipe(Effect.mapError(failed));
    const configuration = yield* decodeConfiguration({
      baseUrl,
      token,
      hostIdentities: parsed,
    }).pipe(Effect.mapError(failed));
    const url = yield* Effect.try({ try: () => new URL(configuration.baseUrl), catch: failed });
    if (
      (url.protocol !== "https:" &&
        !(
          url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
        )) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return yield* failed();
    return PreflightDeviceConfiguration.of({
      configuration: { ...configuration, baseUrl: url.origin },
    });
  }),
);

const OpenResponse = Schema.Struct({
  data: Schema.Struct({
    sessionId: Schema.String,
    leaseToken: Schema.String,
    expiresAt: Schema.String,
  }),
});
const HeartbeatResponse = Schema.Struct({
  data: Schema.Struct({ sessionId: Schema.String, expiresAt: Schema.String }),
});
const ArtifactResponse = Schema.Struct({
  data: Schema.Struct({
    artifactId: Schema.String,
    sha256: Schema.String,
    sizeBytes: Schema.Number,
  }),
});
const CloseResponse = Schema.Struct({
  data: Schema.Struct({
    sessionId: Schema.String,
    status: Schema.Literals(["released", "captured"]),
  }),
});

interface Lease {
  readonly threadId: ThreadId;
  readonly hostId: DeviceHostId;
  readonly deviceId: DeviceId;
  readonly binding: DevicePreflightBinding;
  readonly sessionId: string;
  readonly leaseToken: string;
  expiresAt: string;
  artifactId?: string;
  live: boolean;
  opening: boolean;
  readonly revoked: Deferred.Deferred<void>;
}
const key = (threadId: ThreadId, hostId: DeviceHostId, deviceId: DeviceId) =>
  AgentDeviceTarget.agentDeviceSession(threadId, hostId, deviceId);

/** Wrap the shared service once, so MCP and all clients use the same lifecycle. */
export const coordinate = Effect.fn("PreflightDeviceSessions.coordinate")(function* (
  base: DeviceService["Service"],
) {
  const { configuration } = yield* PreflightDeviceConfiguration;
  const source = yield* PreflightDeviceSource.PreflightDeviceSource;
  const client = HttpClient.withScope(yield* HttpClient.HttpClient);
  const scope = yield* Scope.Scope;
  const lock = yield* Semaphore.make(1);
  const leases = new Map<string, Lease>();
  const managed = (hostId: DeviceHostId) => configuration?.hostIdentities[hostId] !== undefined;
  const request = <S extends Schema.Top>(
    method: "POST" | "PATCH" | "DELETE",
    path: string,
    body: object,
    schema: S,
  ) =>
    Effect.gen(function* () {
      if (!configuration) return yield* failed();
      const req = yield* HttpClientRequest.make(method)(
        `${configuration.baseUrl}/api/preflight/v1/agent-sessions${path}`,
      ).pipe(
        HttpClientRequest.setHeader("authorization", `Bearer ${configuration.token}`),
        HttpClientRequest.bodyJson(body),
        Effect.mapError(failed),
      );
      return yield* client
        .execute(req)
        .pipe(
          Effect.flatMap(HttpClientResponse.filterStatusOk),
          Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
          Effect.scoped,
          Effect.timeout("5 seconds"),
          Effect.mapError(failed),
        );
    });
  const credential = (lease: Lease) => ({
    workspaceId: lease.binding.workspaceId,
    leaseToken: lease.leaseToken,
  });
  const remove = Effect.fn("PreflightDeviceSessions.remove")(function* (
    lease: Lease,
    completion: "released" | "captured" = "released",
  ) {
    if (!lease.live) return;
    yield* Deferred.succeed(lease.revoked, undefined);
    lease.live = false;
    yield* base
      .close({ threadId: lease.threadId, hostId: lease.hostId, deviceId: lease.deviceId })
      .pipe(Effect.ignore);
    yield* request(
      "DELETE",
      `/${encodeURIComponent(lease.sessionId)}`,
      { ...credential(lease), completion },
      CloseResponse,
    ).pipe(Effect.asVoid);
  });
  const check = Effect.fn("PreflightDeviceSessions.check")(function* (lease: Lease) {
    if (!lease.live || (yield* Deferred.isDone(lease.revoked))) return yield* failed();
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    if (!Number.isFinite(Date.parse(lease.expiresAt)) || Date.parse(lease.expiresAt) <= now)
      return yield* failed();
    yield* source.verify(lease.threadId, lease.binding);
    const response = yield* request(
      "PATCH",
      `/${encodeURIComponent(lease.sessionId)}`,
      credential(lease),
      HeartbeatResponse,
    );
    if (
      response.data.sessionId !== lease.sessionId ||
      Date.parse(response.data.expiresAt) <= now ||
      !Number.isFinite(Date.parse(response.data.expiresAt))
    )
      return yield* failed();
    if (!lease.live || (yield* Deferred.isDone(lease.revoked))) return yield* failed();
    lease.expiresAt = response.data.expiresAt;
  });
  const checked = (lease: Lease) =>
    check(lease).pipe(Effect.onError(() => remove(lease).pipe(Effect.ignore)));
  const forDevice = Effect.fn("PreflightDeviceSessions.forDevice")(function* (
    hostId: DeviceHostId,
    deviceId: DeviceId,
    threadId?: ThreadId,
  ) {
    if (!managed(hostId)) return;
    const lease = Array.from(leases.values()).find(
      (lease) =>
        lease.live &&
        lease.hostId === hostId &&
        lease.deviceId === deviceId &&
        (threadId === undefined || lease.threadId === threadId),
    );
    if (!lease) return yield* failed();
    const state = yield* base.state;
    if (
      !state.sessions.some(
        (session) =>
          session.threadId === lease.threadId &&
          session.hostId === hostId &&
          session.deviceId === deviceId,
      )
    ) {
      yield* remove(lease).pipe(Effect.ignore);
      return yield* failed();
    }
    yield* checked(lease);
    return lease;
  });
  const open: DeviceService["Service"]["open"] = (input) =>
    lock.withPermit(
      Effect.gen(function* () {
        const hostId = input.hostId ?? LOCAL_DEVICE_HOST_ID;
        if (!managed(hostId)) {
          if (input.preflight) return yield* failed();
          return yield* base.open(input);
        }
        if (!input.preflight || !configuration) return yield* failed();
        const previous = leases.get(key(input.threadId, hostId, input.deviceId));
        if (previous?.live) {
          if (
            !Object.entries(previous.binding).every(
              ([field, value]) => Reflect.get(input.preflight!, field) === value,
            )
          )
            return yield* failed();
          yield* checked(previous);
          return decorate(yield* base.open(input));
        }
        yield* source.verify(input.threadId, input.preflight);
        const response = yield* request(
          "POST",
          "",
          {
            ...input.preflight,
            threadId: input.threadId,
            hostId,
            providerHostIdentity: configuration.hostIdentities[hostId],
            deviceId: input.deviceId,
            platform: input.platform,
          },
          OpenResponse,
        );
        const lease: Lease = {
          ...response.data,
          threadId: input.threadId,
          hostId,
          deviceId: input.deviceId,
          binding: input.preflight,
          live: true,
          opening: true,
          revoked: yield* Deferred.make<void>(),
        };
        leases.set(key(input.threadId, hostId, input.deviceId), lease);
        // Verify the server's grant before the first native operation; clean up a failed boot.
        return yield* Effect.gen(function* () {
          yield* checked(lease);
          const session = yield* Effect.raceFirst(
            base.open(input),
            Deferred.await(lease.revoked).pipe(Effect.flatMap(() => Effect.fail(failed()))),
          );
          if (session.deviceId !== input.deviceId || session.platform !== input.platform)
            return yield* failed();
          lease.opening = false;
          yield* publish;
          return {
            ...session,
            preflight: { sessionId: lease.sessionId, expiresAt: lease.expiresAt },
          };
        }).pipe(Effect.onError(() => remove(lease).pipe(Effect.ignore)));
      }),
    );
  const decorate = (session: DeviceSession): DeviceSession => {
    const lease = leases.get(key(session.threadId, session.hostId, session.deviceId));
    if (!lease?.live) return session;
    const preflight: NonNullable<DeviceSession["preflight"]> = {
      sessionId: lease.sessionId,
      expiresAt: lease.expiresAt,
    };
    if (lease.artifactId)
      return { ...session, preflight: { ...preflight, artifactId: lease.artifactId } };
    return { ...session, preflight };
  };
  const statePubSub = yield* PubSub.unbounded<DeviceServiceState>();
  const currentState = base.state.pipe(
    Effect.map((state) => ({ ...state, sessions: state.sessions.map(decorate) })),
  );
  const publish = currentState.pipe(
    Effect.flatMap((state) => PubSub.publish(statePubSub, state)),
    Effect.asVoid,
  );
  yield* base.subscribe.pipe(
    Effect.flatMap((subscription) =>
      Stream.fromSubscription(subscription).pipe(Stream.runForEach(() => publish)),
    ),
    Effect.forkIn(scope),
  );
  const coordinated: DeviceService["Service"] = {
    ...base,
    open,
    state: currentState,
    subscribe: PubSub.subscribe(statePubSub),
    configure: (input) =>
      lock.withPermit(
        Effect.gen(function* () {
          if (input.enabled === false || input.agentAccessEnabled === false) {
            for (const lease of leases.values())
              if (lease.live) yield* remove(lease).pipe(Effect.ignore);
          }
          return yield* base.configure(input);
        }),
      ),
    sessionsForThread: (threadId) =>
      base.sessionsForThread(threadId).pipe(Effect.map((sessions) => sessions.map(decorate))),
    close: (input) =>
      lock.withPermit(
        Effect.gen(function* () {
          const closing = Array.from(leases.values()).filter(
            (lease) =>
              lease.live &&
              lease.threadId === input.threadId &&
              (input.hostId === undefined || lease.hostId === input.hostId) &&
              (input.deviceId === undefined || lease.deviceId === input.deviceId),
          );
          // Native shutdown happens while the fence is still held.
          if (input.shutdown) for (const lease of closing) yield* checked(lease);
          yield* base.close(input);
          for (const lease of closing) {
            let completion: "released" | "captured" = "released";
            if (lease.artifactId) {
              const valid = yield* check(lease).pipe(
                Effect.as(true),
                Effect.orElseSucceed(() => false),
              );
              if (valid) completion = "captured";
            }
            yield* remove(lease, completion);
          }
        }),
      ),
    shutdown: (input) =>
      lock.withPermit(
        Effect.gen(function* () {
          const lease = yield* forDevice(input.hostId ?? LOCAL_DEVICE_HOST_ID, input.deviceId);
          yield* base.shutdown(input);
          if (lease) yield* remove(lease);
        }),
      ),
    detail: (input) =>
      lock.withPermit(
        Effect.gen(function* () {
          yield* forDevice(input.hostId ?? LOCAL_DEVICE_HOST_ID, input.deviceId);
          return yield* base.detail(input);
        }),
      ),
    action: (input) =>
      lock.withPermit(
        Effect.gen(function* () {
          yield* forDevice(input.hostId ?? LOCAL_DEVICE_HOST_ID, input.deviceId);
          return yield* base.action(input);
        }),
      ),
    screenshot: (input) =>
      lock.withPermit(
        Effect.gen(function* () {
          const lease = yield* forDevice(
            input.hostId ?? LOCAL_DEVICE_HOST_ID,
            input.deviceId,
            input.threadId,
          );
          const shot = yield* base.screenshot(input);
          if (lease) {
            yield* checked(lease);
            const sha256 = NodeCrypto.createHash("sha256").update(shot.png).digest("hex");
            const result = yield* request(
              "POST",
              `/${encodeURIComponent(lease.sessionId)}/evidence`,
              {
                ...credential(lease),
                capturedAt: DateTime.formatIso(yield* DateTime.now),
                pngBase64: Buffer.from(shot.png).toString("base64"),
                sha256,
              },
              ArtifactResponse,
            );
            if (result.data.sha256 !== sha256 || result.data.sizeBytes !== shot.png.byteLength)
              return yield* failed();
            lease.artifactId = result.data.artifactId;
            yield* publish;
          }
          return shot;
        }),
      ),
  };
  const guard = Effect.fn("PreflightDeviceSessions.guard")(function* (session: DeviceSession) {
    const lease = yield* forDevice(session.hostId, session.deviceId, session.threadId);
    if (lease && session.preflight?.sessionId !== lease.sessionId) return yield* failed();
  });
  const hostManaged = (hostId: DeviceHostId) => managed(hostId);
  const closeHost = (hostId: DeviceHostId) =>
    lock.withPermit(
      Effect.gen(function* () {
        for (const lease of leases.values())
          if (lease.live && lease.hostId === hostId) yield* remove(lease).pipe(Effect.ignore);
      }),
    );
  yield* Effect.gen(function* () {
    while (true) {
      yield* Effect.sleep("30 seconds");
      for (const lease of leases.values()) {
        if (!lease.live) continue;
        const valid = yield* check(lease).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        );
        const state = yield* base.state;
        const present =
          lease.opening ||
          state.sessions.some(
            (session) =>
              session.threadId === lease.threadId &&
              session.hostId === lease.hostId &&
              session.deviceId === lease.deviceId,
          );
        if (!valid || !present) {
          yield* Deferred.succeed(lease.revoked, undefined);
          yield* lock.withPermit(remove(lease).pipe(Effect.ignore));
        }
        yield* publish;
      }
    }
  }).pipe(Effect.forkIn(scope));
  yield* Effect.addFinalizer(() =>
    Effect.forEach(
      Array.from(leases.values()).filter((lease) => lease.live),
      (lease) => remove(lease).pipe(Effect.ignore),
      { discard: true },
    ),
  );
  const command = <A>(session: DeviceSession, execute: Effect.Effect<A, DeviceError>) =>
    lock.withPermit(
      Effect.gen(function* () {
        yield* guard(session);
        const lease = leases.get(key(session.threadId, session.hostId, session.deviceId));
        const result = yield* lease
          ? Effect.raceFirst(
              execute,
              Deferred.await(lease.revoked).pipe(Effect.flatMap(() => Effect.fail(failed()))),
            )
          : execute;
        yield* guard(session);
        return result;
      }),
    );
  return {
    service: coordinated,
    guard,
    hostManaged,
    command,
    closeHost,
    enabled: configuration !== null && Object.keys(configuration.hostIdentities).length > 0,
  };
});
