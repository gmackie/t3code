import {
  AuthOrchestrationReadScope,
  AuthSessionId,
  LiveActivityError,
  type LiveActivityRegistration,
  type LiveActivitySnapshot,
} from "@t3tools/contracts";
import { projectThreadAwarenessV2 } from "@t3tools/shared/agentAwareness";
import { makeAggregateState } from "@t3tools/shared/agentActivityAggregate";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as SessionStore from "../auth/SessionStore.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as LiveActivityApns from "./LiveActivityApns.ts";

const isLiveActivityError = Schema.is(LiveActivityError);
const encodeSignature = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const STORE_KEY = "notifications/live-activities.json";
const Devices = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      sessionId: AuthSessionId,
      activityId: Schema.String,
      token: Schema.String,
      registeredAt: Schema.Number,
    }),
  ),
);

export class LiveActivities extends Context.Service<
  LiveActivities,
  {
    readonly snapshot: Effect.Effect<LiveActivitySnapshot, LiveActivityError>;
    readonly register: (
      sessionId: AuthSessionId,
      registration: LiveActivityRegistration,
    ) => Effect.Effect<void, LiveActivityError>;
    readonly publish: Effect.Effect<void, LiveActivityError>;
  }
>()("t3/notifications/LiveActivities") {}

const decodeDevices = Schema.decodeEffect(Devices);
const encodeDevices = Schema.encodeEffect(Devices);

const make = Effect.gen(function* () {
  const apns = yield* LiveActivityApns.LiveActivityApns;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const sessions = yield* SessionStore.SessionStore;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const projects = yield* ProjectService.ProjectService;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const lock = yield* Semaphore.make(1);
  const stored = yield* secrets.get(STORE_KEY);
  let devices = Option.isSome(stored)
    ? yield* decodeDevices(new TextDecoder().decode(stored.value))
    : [];
  const delivered = new Map<string, { readonly signature: string; readonly at: number }>();
  const persist = Effect.fn("LiveActivities.persist")(function* (next: typeof devices) {
    const encoded = yield* encodeDevices(next);
    yield* secrets.set(STORE_KEY, new TextEncoder().encode(encoded));
    devices = next;
  });
  const snapshot = Effect.gen(function* () {
    const configured = yield* apns.configured;
    if (!configured) return { configured, aggregate: null };
    const environmentId = yield* environment.getEnvironmentId;
    const [shell, projectSnapshot] = yield* Effect.all([
      threads.getShellSnapshot(),
      projects.snapshot,
    ]);
    const projectsById = new Map(projectSnapshot.projects.map((project) => [project.id, project]));
    const now = yield* DateTime.now;
    const states = shell.threads.flatMap((thread) => {
      if (
        thread.archivedAt !== null ||
        thread.deletedAt !== null ||
        thread.lineage.relationshipToParent === "subagent"
      )
        return [];
      const project = projectsById.get(thread.projectId);
      if (!project) return [];
      const state = projectThreadAwarenessV2({ environmentId, project, thread });
      // A fresh snapshot attests that active work is still running, including quiet long turns.
      return state
        ? [
            {
              ...state,
              updatedAt:
                state.phase === "completed" || state.phase === "failed"
                  ? state.updatedAt
                  : DateTime.formatIso(now),
            },
          ]
        : [];
    });
    return {
      configured,
      aggregate: makeAggregateState({
        activeStates: states,
        terminalState: null,
        nowMs: now.epochMilliseconds,
      }),
    };
  }).pipe(Effect.mapError((cause) => new LiveActivityError({ cause })));
  const emptyState = Effect.gen(function* () {
    return {
      title: "T3 Code",
      subtitle: "Agent work ended",
      activeCount: 0,
      updatedAt: DateTime.formatIso(yield* DateTime.now),
      activities: [],
    };
  });
  const deliver = Effect.fn("LiveActivities.deliver")(function* (
    device: (typeof devices)[number],
    delivery: Omit<LiveActivityApns.Delivery, "token">,
    force = false,
  ) {
    const now = (yield* DateTime.now).epochMilliseconds;
    const signature = encodeSignature({
      event: delivery.event,
      state: {
        ...delivery.state,
        updatedAt: "",
        activities: delivery.state.activities.map((row) => ({ ...row, updatedAt: "" })),
      },
    });
    const previous = delivered.get(device.token);
    if (
      !force &&
      delivery.event === "update" &&
      previous !== undefined &&
      previous.signature === signature &&
      now - previous.at < 5 * 60_000
    )
      return true;
    const result = yield* apns.send({ ...delivery, token: device.token });
    if (
      result.status === 200 ||
      result.status === 410 ||
      (result.status === 400 && result.reason === "BadDeviceToken")
    ) {
      if (delivery.event === "end" || result.status !== 200) {
        delivered.delete(device.token);
        yield* persist(devices.filter((candidate) => candidate !== device));
      } else delivered.set(device.token, { signature, at: now });
      return result.status === 200;
    }
    yield* Effect.logWarning("APNs rejected a Live Activity update", {
      status: result.status,
      reason: result.reason?.slice(0, 80) ?? "unknown",
    });
    return yield* new LiveActivityError({
      cause: { status: result.status, reason: result.reason },
    });
  });
  const wrap = <A, E>(effect: Effect.Effect<A, E>) =>
    effect.pipe(
      lock.withPermits(1),
      Effect.mapError((cause) =>
        isLiveActivityError(cause) ? cause : new LiveActivityError({ cause }),
      ),
    );
  const register = Effect.fn("LiveActivities.register")(
    function* (sessionId: AuthSessionId, input: LiveActivityRegistration) {
      const previous = devices.find((device) => device.sessionId === sessionId);
      if (input.token === null) {
        // Remove even when the APNs end request fails: disabling must stop all future updates.
        if (previous) {
          yield* persist(devices.filter((device) => device !== previous));
          delivered.delete(previous.token);
          yield* apns
            .send({ token: previous.token, event: "end", state: yield* emptyState })
            .pipe(Effect.ignore);
        }
        return;
      }
      if (!input.activityId || !(yield* apns.configured))
        return yield* new LiveActivityError({ cause: "APNs not configured or invalid activity" });
      if (previous && previous.activityId !== input.activityId) {
        delivered.delete(previous.token);
        yield* apns
          .send({ token: previous.token, event: "end", state: yield* emptyState })
          .pipe(Effect.ignore);
      }
      const device = {
        sessionId,
        activityId: input.activityId,
        token: input.token.toLowerCase(),
        registeredAt:
          previous?.activityId === input.activityId
            ? previous.registeredAt
            : (yield* DateTime.now).epochMilliseconds,
      };
      yield* persist([
        ...devices.filter(
          (candidate) => candidate.sessionId !== sessionId && candidate.token !== device.token,
        ),
        device,
      ]);
      const { aggregate } = yield* snapshot;
      const accepted = yield* deliver(
        device,
        {
          event: aggregate && aggregate.activeCount > 0 ? "update" : "end",
          state: aggregate ?? (yield* emptyState),
        },
        true,
      );
      if (!accepted)
        return yield* new LiveActivityError({ cause: "APNs rejected this activity token" });
    },
    (effect) => wrap(effect),
  );
  const publish = wrap(
    Effect.gen(function* () {
      if (devices.length === 0 || !(yield* apns.configured)) return;
      const activeSessions = new Set(
        (yield* sessions.listActive())
          .filter((session) => session.scopes.includes(AuthOrchestrationReadScope))
          .map((session) => session.sessionId),
      );
      const { aggregate } = yield* snapshot;
      const now = (yield* DateTime.now).epochMilliseconds;
      let failed = false;
      for (const device of devices) {
        const authorized =
          activeSessions.has(device.sessionId) && now - device.registeredAt < 8 * 60 * 60_000;
        const state = authorized && aggregate ? aggregate : yield* emptyState;
        yield* deliver(device, {
          state,
          event: authorized && state.activeCount > 0 ? "update" : "end",
        }).pipe(
          Effect.catch(() => {
            failed = true;
            return Effect.void;
          }),
        );
        // Revoked credentials never retain a registration just because APNs is unreachable.
        if (!authorized && devices.includes(device))
          yield* persist(devices.filter((candidate) => candidate !== device));
      }
      if (failed) return yield* new LiveActivityError({ cause: "APNs delivery failed" });
    }),
  );
  return LiveActivities.of({ snapshot, register, publish });
});

export const layer = Layer.effect(LiveActivities, make);
