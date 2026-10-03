import {
  AuthOrchestrationReadScope,
  ExpoPushError,
  type AuthSessionId,
  type ExpoPushRegistration,
} from "@t3tools/contracts";
import type { AgentAwarenessState } from "@t3tools/shared/agentAwareness";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as SessionStore from "../auth/SessionStore.ts";

const Device = Schema.Struct({
  sessionId: Schema.String,
  token: Schema.String,
  registeredAt: Schema.Number,
  sent: Schema.Record(Schema.String, Schema.String),
});
const Devices = Schema.Array(Device);
const decodeDevices = Schema.decodeEffect(Schema.fromJsonString(Devices));
const encodeDevices = Schema.encodeEffect(Schema.fromJsonString(Devices));
const Delivery = Schema.Struct({
  status: Schema.Literals(["ok", "error"]),
  id: Schema.optionalKey(Schema.String),
  details: Schema.optionalKey(Schema.Struct({ error: Schema.optionalKey(Schema.String) })),
});
const TicketResponse = Schema.Struct({ data: Delivery });
const ReceiptResponse = Schema.Struct({ data: Schema.Record(Schema.String, Delivery) });
const STORE_KEY = "expo-push-devices";

export class ExpoPush extends Context.Service<
  ExpoPush,
  {
    readonly hasRegistrations: Effect.Effect<boolean>;
    readonly register: (
      sessionId: AuthSessionId,
      input: ExpoPushRegistration,
    ) => Effect.Effect<void, ExpoPushError>;
    readonly publish: (
      state: AgentAwarenessState,
      identity: string,
      occurredAt: number,
    ) => Effect.Effect<void, ExpoPushError>;
    readonly checkReceipts: Effect.Effect<void, ExpoPushError>;
  }
>()("t3/notifications/ExpoPush") {}

const make = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const sessions = yield* SessionStore.SessionStore;
  const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
  const lock = yield* Semaphore.make(1);
  const stored = yield* secrets.get(STORE_KEY);
  let devices = Option.isSome(stored)
    ? [...(yield* decodeDevices(new TextDecoder().decode(stored.value)))]
    : [];
  // Receipts are checked on a bounded cadence; a server restart can lose pending
  // receipts, but a subsequent send still detects unregistered devices.
  const receipts = new Map<string, { token: string; createdAt: number }>();
  const persist = Effect.fnUntraced(function* () {
    const json = yield* encodeDevices(devices);
    yield* secrets.set(STORE_KEY, new TextEncoder().encode(json));
  });
  const post = Effect.fnUntraced(function* (path: string, body: unknown) {
    const request = yield* HttpClientRequest.bodyJson(
      HttpClientRequest.post(`https://exp.host/--/api/v2/push/${path}`),
      body,
    );
    return yield* http.execute(request).pipe(
      Effect.flatMap((response) => response.json),
      Effect.timeout("15 seconds"),
    );
  });
  const wrap = <A, E>(effect: Effect.Effect<A, E>) =>
    effect.pipe(
      lock.withPermits(1),
      Effect.mapError((cause) => new ExpoPushError({ cause })),
    );
  const register = (sessionId: AuthSessionId, input: ExpoPushRegistration) =>
    wrap(
      Effect.gen(function* () {
        const previous = devices.find(
          (device) =>
            device.sessionId === sessionId ||
            (input.token !== null && device.token === input.token),
        );
        const next = devices.filter(
          (device) => device.sessionId !== sessionId && device.token !== input.token,
        );
        if (input.token !== null) {
          next.push({
            sessionId,
            token: input.token,
            registeredAt: previous?.registeredAt ?? (yield* DateTime.now).epochMilliseconds,
            sent: previous?.sent ?? {},
          });
        }
        const before = devices;
        devices = next;
        yield* persist().pipe(
          Effect.tapError(() =>
            Effect.sync(() => {
              devices = before;
            }),
          ),
        );
      }),
    );
  const publish = (state: AgentAwarenessState, identity: string, occurredAt: number) =>
    wrap(
      Effect.gen(function* () {
        if (
          !["completed", "failed", "waiting_for_approval", "waiting_for_input"].includes(
            state.phase,
          ) ||
          devices.length === 0
        )
          return;
        const active = new Set(
          (yield* sessions.listActive())
            .filter((session) => session.scopes.includes(AuthOrchestrationReadScope))
            .map((session) => String(session.sessionId)),
        );
        const previousCount = devices.length;
        devices = devices.filter((device) => active.has(device.sessionId));
        let changed = previousCount !== devices.length;
        let failures = 0;
        const now = (yield* DateTime.now).epochMilliseconds;
        for (const device of devices) {
          if (occurredAt < device.registeredAt || device.sent[state.threadId] === identity)
            continue;
          const response = yield* post("send", {
            to: device.token,
            title: state.headline,
            body: `${state.projectTitle} · ${state.threadTitle}`.slice(0, 180),
            sound: "default",
            ttl: 300,
            data: {
              environmentId: state.environmentId,
              threadId: state.threadId,
              deepLink: state.deepLink,
            },
          }).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(TicketResponse)),
            Effect.catch(() => {
              failures++;
              return Effect.succeed(null);
            }),
          );
          if (response === null) continue;
          if (response.data.status === "error") {
            if (response.data.details?.error === "DeviceNotRegistered") {
              devices = devices.filter((candidate) => candidate.token !== device.token);
              changed = true;
            } else {
              yield* Effect.logWarning("Expo rejected a notification", {
                reason: response.data.details?.error ?? "unknown",
              });
            }
          } else {
            changed = true;
            // Retain only recent thread identities, keeping registration state bounded.
            const sent = Object.fromEntries([
              ...Object.entries(device.sent)
                .filter(([key]) => key !== state.threadId)
                .slice(-255),
              [state.threadId, identity],
            ]);
            devices = devices.map((candidate) =>
              candidate === device ? { ...device, sent } : candidate,
            );
            if (response.data.id && receipts.size < 1000)
              receipts.set(response.data.id, { token: device.token, createdAt: now });
          }
        }
        if (changed) yield* persist();
        if (failures > 0)
          return yield* new ExpoPushError({ cause: "Expo delivery request failed" });
      }),
    );
  const checkReceipts = wrap(
    Effect.gen(function* () {
      const now = (yield* DateTime.now).epochMilliseconds;
      const due = [...receipts].filter(([, value]) => now - value.createdAt >= 15 * 60_000);
      if (due.length === 0) return;
      const response = yield* post("getReceipts", { ids: due.map(([id]) => id) }).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(ReceiptResponse)),
      );
      for (const [id, pending] of due) {
        const receipt = response.data[id];
        if (!receipt && now - pending.createdAt < 24 * 60 * 60_000) continue;
        receipts.delete(id);
        if (receipt?.details?.error === "DeviceNotRegistered")
          devices = devices.filter((device) => device.token !== pending.token);
        else if (receipt?.status === "error")
          yield* Effect.logWarning("Expo notification delivery failed", {
            reason: receipt.details?.error ?? "unknown",
          });
      }
      yield* persist();
    }),
  );
  return ExpoPush.of({
    hasRegistrations: Effect.sync(() => devices.length > 0),
    register,
    publish,
    checkReceipts,
  });
});
export const layer = Layer.effect(ExpoPush, make).pipe(Layer.provide(FetchHttpClient.layer));
