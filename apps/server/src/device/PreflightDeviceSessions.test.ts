import * as NodeCrypto from "node:crypto";
import { describe, expect, it } from "@effect/vitest";
import {
  DeviceId,
  DeviceOperationError,
  LOCAL_DEVICE_HOST_ID,
  ThreadId,
  type DevicePreflightBinding,
  type DeviceServiceState,
  type DeviceSession,
  type DeviceSummary,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as PubSub from "effect/PubSub";
import { TestClock } from "effect/testing";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import type { DeviceService } from "./DeviceService.ts";
import * as PreflightDeviceSessions from "./PreflightDeviceSessions.ts";
import * as PreflightDeviceSource from "./PreflightDeviceSource.ts";

const threadId = ThreadId.make("lease-thread");
const deviceId = DeviceId.make("device-one");
const binding: DevicePreflightBinding = {
  workspaceId: "workspace",
  appId: "app",
  workflowId: "workflow",
  targetId: "target",
  sourceBindingId: "source",
  expectedHeadSha: "a".repeat(40),
  repositoryRemote: "https://git.example/owner/repo",
};
const expiresAt = "2099-01-01T00:00:00Z";
const device: DeviceSummary = {
  hostId: LOCAL_DEVICE_HOST_ID,
  id: deviceId,
  platform: "ios",
  name: "Test device",
  version: "iOS",
  booted: true,
  physical: false,
};
const session: DeviceSession = {
  threadId,
  deviceId,
  hostId: LOCAL_DEVICE_HOST_ID,
  platform: "ios",
  openedAt: "2026-10-05T00:00:00Z",
};
const png = new Uint8Array(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/V5sAAAAASUVORK5CYII=",
    "base64",
  ),
);
const sha256 = NodeCrypto.createHash("sha256").update(png).digest("hex");
const input = {
  threadId,
  deviceId,
  hostId: LOCAL_DEVICE_HOST_ID,
  platform: "ios" as const,
  preflight: binding,
};

function fixture() {
  const events: string[] = [];
  const bodies: string[] = [];
  const released = Deferred.makeUnsafe<void>();
  let sessions: DeviceSession[] = [];
  const state = (): DeviceServiceState => ({
    hosts: [],
    hostStatus: "ready",
    hostStatuses: {},
    devices: [device],
    sessions,
    onboardingCompleted: true,
    agentAccessEnabled: true,
    hubBasePath: "/api/device-hub",
    revision: 0,
  });
  const controls = {
    denyGrant: false,
    denyHeartbeat: false,
    sourceChanged: false,
    failBoot: false,
    badArtifact: false,
    sessionId: "lease-one",
  };
  const unused = () => Effect.die("Unexpected native operation");
  const base: DeviceService["Service"] = {
    agentCli: unused(),
    testHost: unused,
    agentTarget: unused,
    state: Effect.sync(state),
    subscribe: PubSub.unbounded<DeviceServiceState>().pipe(Effect.flatMap(PubSub.subscribe)),
    configure: unused,
    list: unused(),
    updateTool: unused,
    inspect: unused(),
    retryHost: unused,
    readiness: unused,
    readinessIfSupported: unused,
    agentReadinessIfSupported: unused,
    currentReadiness: unused,
    sessionsForThread: (id) => Effect.sync(() => sessions.filter((item) => item.threadId === id)),
    open: () =>
      Effect.gen(function* () {
        events.push("native:boot");
        if (controls.failBoot)
          return yield* new DeviceOperationError({
            operation: "boot",
            reason: "request_failed",
            cause: new Error("Boot failed"),
          });
        sessions = [session];
        return session;
      }),
    close: () =>
      Effect.sync(() => {
        events.push("native:close");
        sessions = [];
      }),
    shutdown: () =>
      Effect.sync(() => {
        events.push("native:shutdown");
        sessions = [];
      }),
    detail: unused,
    action: () =>
      Effect.sync(() => {
        events.push("native:action");
        return {
          hostId: LOCAL_DEVICE_HOST_ID,
          deviceId,
          settings: {},
          foregroundApp: null,
          readAt: expiresAt,
        };
      }),
    screenshot: () =>
      Effect.sync(() => {
        events.push("native:screenshot");
        return { device, png };
      }),
  };
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      const path = new URL(request.url).pathname;
      const operation = path.endsWith("/evidence")
        ? "evidence"
        : request.method === "POST"
          ? "acquire"
          : request.method === "PATCH"
            ? "heartbeat"
            : "release";
      events.push(`lease:${operation}`);
      expect(request.headers.authorization).toBe("Bearer producer-test");
      if (request.body._tag === "Uint8Array")
        bodies.push(new TextDecoder().decode(request.body.body));
      const denied =
        operation === "acquire"
          ? controls.denyGrant
          : operation === "heartbeat" && controls.denyHeartbeat;
      const data =
        operation === "acquire"
          ? { sessionId: controls.sessionId, leaseToken: "lease-test", expiresAt }
          : operation === "heartbeat"
            ? { sessionId: controls.sessionId, expiresAt }
            : operation === "evidence"
              ? {
                  artifactId: "artifact-one",
                  sha256: controls.badArtifact ? "wrong" : sha256,
                  sizeBytes: png.byteLength,
                }
              : { sessionId: controls.sessionId, status: "released" };
      return HttpClientResponse.fromWeb(
        request,
        Response.json({ data }, { status: denied ? 409 : 200 }),
      );
    }).pipe(
      Effect.tap(() =>
        request.method === "DELETE" ? Deferred.succeed(released, undefined) : Effect.void,
      ),
    ),
  );
  const coordinate = PreflightDeviceSessions.coordinate(base).pipe(
    Effect.provideService(PreflightDeviceSessions.PreflightDeviceConfiguration, {
      configuration: {
        baseUrl: "https://preflight.test",
        token: "producer-test",
        hostIdentities: { [LOCAL_DEVICE_HOST_ID]: "machine-one" },
      },
    }),
    Effect.provideService(PreflightDeviceSource.PreflightDeviceSource, {
      verify: () =>
        Effect.gen(function* () {
          events.push("source:verify");
          if (controls.sourceChanged)
            return yield* new DeviceOperationError({
              operation: "source",
              reason: "request_failed",
              cause: new Error("Source changed"),
            });
        }),
    }),
    Effect.provideService(HttpClient.HttpClient, http),
  );
  return { coordinate, events, bodies, controls, released };
}

describe("PreflightDeviceSessions", () => {
  it.effect("close waits for a command to finish before releasing the lease", () =>
    Effect.gen(function* () {
      const test = fixture();
      const coordinator = yield* test.coordinate;
      const opened = yield* coordinator.service.open(input);
      const started = yield* Deferred.make<void>();
      const finish = yield* Deferred.make<void>();
      const closing = yield* Deferred.make<void>();
      const command = yield* coordinator
        .command(
          opened,
          Effect.gen(function* () {
            yield* Deferred.succeed(started, undefined);
            yield* Deferred.await(finish);
            test.events.push("command:finished");
            return "done";
          }),
        )
        .pipe(Effect.forkChild);
      yield* Deferred.await(started);
      const close = yield* Deferred.succeed(closing, undefined).pipe(
        Effect.andThen(coordinator.service.close({ threadId, deviceId })),
        Effect.forkChild,
      );
      yield* Deferred.await(closing);
      yield* Effect.yieldNow;
      expect(test.events).not.toContain("lease:release");
      yield* Deferred.succeed(finish, undefined);
      expect(yield* Fiber.join(command)).toBe("done");
      yield* Fiber.join(close);
      expect(test.events.indexOf("command:finished")).toBeLessThan(
        test.events.indexOf("native:close"),
      );
      expect(test.events.indexOf("native:close")).toBeLessThan(
        test.events.indexOf("lease:release"),
      );
    }).pipe(Effect.scoped),
  );

  it.effect("an old session cannot run commands after the device is reopened", () =>
    Effect.gen(function* () {
      const test = fixture();
      const coordinator = yield* test.coordinate;
      const old = yield* coordinator.service.open(input);
      yield* coordinator.service.close({ threadId, deviceId });
      test.controls.sessionId = "lease-two";
      const current = yield* coordinator.service.open(input);
      expect(current.preflight?.sessionId).toBe("lease-two");
      let executions = 0;
      const execute = Effect.sync(() => ++executions);
      yield* coordinator.command(old, execute).pipe(Effect.flip);
      expect(executions).toBe(0);
      expect(yield* coordinator.command(current, execute)).toBe(1);
    }).pipe(Effect.scoped),
  );

  it.effect("heartbeat loss cancels an active command before native close and lease release", () =>
    Effect.gen(function* () {
      const test = fixture();
      const coordinator = yield* test.coordinate;
      const opened = yield* coordinator.service.open(input);
      const started = yield* Deferred.make<void>();
      const command = yield* coordinator
        .command(
          opened,
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                test.events.push("command:cancelled");
              }),
            ),
          ),
        )
        .pipe(Effect.flip, Effect.forkChild);
      yield* Deferred.await(started);
      test.controls.denyHeartbeat = true;
      yield* TestClock.adjust("30 seconds");
      const error = yield* Fiber.join(command);
      expect(error._tag).toBe("DeviceOperationError");
      yield* Deferred.await(test.released);
      expect(test.events).toContain("command:cancelled");
      expect(test.events.indexOf("command:cancelled")).toBeLessThan(
        test.events.indexOf("native:close"),
      );
      expect(test.events.indexOf("native:close")).toBeLessThan(
        test.events.indexOf("lease:release"),
      );
      expect((yield* coordinator.service.state).sessions).toEqual([]);
    }).pipe(Effect.scoped),
  );
  it.effect("acquires and validates the lease before boot, then releases on close", () =>
    Effect.gen(function* () {
      const test = fixture();
      const { service } = yield* test.coordinate;
      const opened = yield* service.open(input);
      expect(test.events.slice(0, 5)).toEqual([
        "source:verify",
        "lease:acquire",
        "source:verify",
        "lease:heartbeat",
        "native:boot",
      ]);
      expect(opened.preflight?.sessionId).toBe("lease-one");
      yield* service.close({ threadId, deviceId });
      expect(test.events.indexOf("native:close")).toBeLessThan(
        test.events.indexOf("lease:release"),
      );
      expect(test.bodies.at(-1)).toContain('"completion":"released"');
      expect((yield* service.state).sessions).toEqual([]);
    }).pipe(Effect.scoped),
  );

  it.effect("a denied grant never boots or opens a native session", () =>
    Effect.gen(function* () {
      const test = fixture();
      test.controls.denyGrant = true;
      const { service } = yield* test.coordinate;
      yield* service.open(input).pipe(Effect.flip);
      expect(test.events).toEqual(["source:verify", "lease:acquire"]);
    }).pipe(Effect.scoped),
  );

  it.effect("rejects a source mismatch before requesting a lease", () =>
    Effect.gen(function* () {
      const test = fixture();
      test.controls.sourceChanged = true;
      const { service } = yield* test.coordinate;
      yield* service.open(input).pipe(Effect.flip);
      expect(test.events).toEqual(["source:verify"]);
    }).pipe(Effect.scoped),
  );

  it.effect("releases a granted lease when native boot fails", () =>
    Effect.gen(function* () {
      const test = fixture();
      test.controls.failBoot = true;
      const { service } = yield* test.coordinate;
      yield* service.open(input).pipe(Effect.flip);
      expect(test.events).toContain("lease:release");
      expect((yield* service.state).sessions).toEqual([]);
    }).pipe(Effect.scoped),
  );

  it.effect("heartbeat loss closes the native session and blocks further actions", () =>
    Effect.gen(function* () {
      const test = fixture();
      const { service } = yield* test.coordinate;
      yield* service.open(input);
      test.controls.denyHeartbeat = true;
      yield* service
        .action({ hostId: LOCAL_DEVICE_HOST_ID, deviceId, type: "setAppearance", value: "dark" })
        .pipe(Effect.flip);
      expect(test.events).not.toContain("native:action");
      expect(test.events).toContain("native:close");
      expect(test.events).toContain("lease:release");
      expect((yield* service.state).sessions).toEqual([]);
    }).pipe(Effect.scoped),
  );

  it.effect("captures the actual screenshot bytes and closes as captured", () =>
    Effect.gen(function* () {
      const test = fixture();
      const { service } = yield* test.coordinate;
      yield* service.open(input);
      yield* service.screenshot({ hostId: LOCAL_DEVICE_HOST_ID, deviceId });
      expect((yield* service.state).sessions[0]?.preflight?.artifactId).toBe("artifact-one");
      const evidence = test.bodies.find((body) => body.includes("pngBase64"));
      expect(evidence).toContain(sha256);
      expect(evidence).toContain(Buffer.from(png).toString("base64"));
      yield* service.close({ threadId, deviceId });
      expect(test.bodies.at(-1)).toContain('"completion":"captured"');
    }).pipe(Effect.scoped),
  );

  it.effect("does not mark a bad evidence receipt as captured", () =>
    Effect.gen(function* () {
      const test = fixture();
      const { service } = yield* test.coordinate;
      yield* service.open(input);
      test.controls.badArtifact = true;
      yield* service.screenshot({ hostId: LOCAL_DEVICE_HOST_ID, deviceId }).pipe(Effect.flip);
      yield* service.close({ threadId, deviceId });
      expect(test.bodies.at(-1)).toContain('"completion":"released"');
    }).pipe(Effect.scoped),
  );
});
