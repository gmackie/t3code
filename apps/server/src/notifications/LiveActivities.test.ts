import { assert, it } from "@effect/vitest";
import {
  AuthOrchestrationReadScope,
  AuthSessionId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as SessionStore from "../auth/SessionStore.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import { v2PullRequestThread } from "../orchestration-v2/testkit/pullRequestFixtures.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as LiveActivityApns from "./LiveActivityApns.ts";
import * as LiveActivities from "./LiveActivities.ts";

const sessionId = AuthSessionId.make("phone");
const token = "a".repeat(64);
const setup = Effect.gen(function* () {
  const now = yield* DateTime.now;
  const iso = DateTime.formatIso(now);
  const values = new Map<string, Uint8Array>();
  const deliveries: Array<LiveActivityApns.Delivery> = [];
  let configured = true;
  let response = { status: 200, reason: null as string | null };
  let active = true;
  const projectId = ProjectId.make("project");
  let thread = {
    ...v2PullRequestThread({
      id: ThreadId.make("thread"),
      projectId,
      title: "Task",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      pullRequests: [],
      latestUserMessageAt: iso,
      createdAt: iso,
      updatedAt: iso,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
    }),
    status: "running" as "running" | "completed",
    latestRunId: RunId.make("run"),
    latestRunCompletedAt: null as DateTime.Utc | null,
  };
  const dependencies = Layer.mergeAll(
    Layer.succeed(LiveActivityApns.LiveActivityApns, {
      configured: Effect.sync(() => configured),
      send: (input) =>
        Effect.sync(() => {
          deliveries.push(input);
          return response;
        }),
    }),
    Layer.mock(ServerSecretStore.ServerSecretStore)({
      get: (key) => Effect.sync(() => Option.fromUndefinedOr(values.get(key))),
      set: (key, value) =>
        Effect.sync(() => {
          values.set(key, value);
        }),
    }),
    Layer.mock(SessionStore.SessionStore)({
      cookieName: "test",
      legacyCookieName: undefined,
      listActive: () =>
        Effect.succeed(
          active
            ? [
                {
                  sessionId,
                  scopes: [AuthOrchestrationReadScope],
                  subject: "phone",
                  method: "bearer-access-token",
                  client: { deviceType: "mobile" },
                  issuedAt: now,
                  expiresAt: DateTime.add(now, { days: 30 }),
                  lastConnectedAt: null,
                  connected: false,
                  current: false,
                },
              ]
            : [],
        ),
    }),
    Layer.mock(ThreadManagement.ThreadManagementService)({
      getShellSnapshot: () =>
        Effect.succeed({
          schemaVersion: 2,
          snapshotSequence: 1,
          threads: [thread],
          archivedThreads: [],
        }),
    }),
    Layer.mock(ProjectService.ProjectService)({
      snapshot: Effect.succeed({
        updatedAt: iso,
        projects: [
          {
            id: projectId,
            title: "Project",
            workspaceRoot: "/project",
            defaultModelSelection: null,
            scripts: [],
            createdAt: iso,
            updatedAt: iso,
            deletedAt: null,
          },
        ],
      }),
    }),
    Layer.mock(ServerEnvironment.ServerEnvironment)({
      getEnvironmentId: Effect.succeed(EnvironmentId.make("env")),
    }),
  );
  const build = Effect.gen(function* () {
    return Context.get(
      yield* Layer.build(LiveActivities.layer.pipe(Layer.provide(dependencies))),
      LiveActivities.LiveActivities,
    );
  });
  return {
    build,
    deliveries,
    setConfigured: (value: boolean) => {
      configured = value;
    },
    respond: (status: number, reason: string | null) => {
      response = { status, reason };
    },
    revoke: () => {
      active = false;
    },
    complete: () => {
      thread = { ...thread, status: "completed", latestRunCompletedAt: now };
    },
  };
});

it.effect(
  "replays current running work to a newly registered activity and ends it on completion",
  () =>
    Effect.gen(function* () {
      const test = yield* setup;
      const service = yield* test.build;
      yield* service.register(sessionId, { activityId: "activity", token });
      assert.equal(test.deliveries[0]?.event, "update");
      assert.equal(test.deliveries[0]?.state.activeCount, 1);
      test.complete();
      yield* service.publish;
      assert.equal(test.deliveries.at(-1)?.event, "end");
      assert.equal(test.deliveries.at(-1)?.state.activeCount, 0);
      yield* service.publish;
      assert.lengthOf(test.deliveries, 2);
    }).pipe(Effect.scoped),
);

it.effect(
  "persists registrations across restarts, repairs token rotation, and unregisters independently of Expo",
  () =>
    Effect.gen(function* () {
      const test = yield* setup;
      const service = yield* test.build;
      yield* service.register(sessionId, { activityId: "activity", token });
      const restarted = yield* test.build;
      yield* restarted.publish;
      assert.lengthOf(test.deliveries, 2);
      yield* restarted.register(sessionId, { activityId: "activity", token: "b".repeat(64) });
      assert.equal(test.deliveries.at(-1)?.token, "b".repeat(64));
      yield* restarted.register(sessionId, { activityId: null, token: null });
      assert.equal(test.deliveries.at(-1)?.event, "end");
      const count = test.deliveries.length;
      yield* restarted.publish;
      assert.lengthOf(test.deliveries, count);
    }).pipe(Effect.scoped),
);

it.effect("ends revoked sessions without disclosing current work and prunes rejected tokens", () =>
  Effect.gen(function* () {
    const test = yield* setup;
    const service = yield* test.build;
    yield* service.register(sessionId, { activityId: "activity", token });
    test.revoke();
    yield* service.publish;
    assert.equal(test.deliveries.at(-1)?.event, "end");
    assert.lengthOf(test.deliveries.at(-1)!.state.activities, 0);
    const count = test.deliveries.length;
    yield* service.publish;
    assert.lengthOf(test.deliveries, count);
    const other = yield* setup;
    const otherService = yield* other.build;
    other.respond(410, "Unregistered");
    assert.equal(
      (yield* Effect.result(otherService.register(sessionId, { activityId: "activity", token })))
        ._tag,
      "Failure",
    );
    yield* otherService.publish;
    assert.lengthOf(other.deliveries, 1);
  }).pipe(Effect.scoped),
);

it.effect(
  "refuses enrollment when APNs is not configured instead of showing an unmaintained card",
  () =>
    Effect.gen(function* () {
      const test = yield* setup;
      test.setConfigured(false);
      const service = yield* test.build;
      assert.isFalse((yield* service.snapshot).configured);
      assert.equal(
        (yield* Effect.result(service.register(sessionId, { activityId: "activity", token })))._tag,
        "Failure",
      );
      assert.lengthOf(test.deliveries, 0);
    }).pipe(Effect.scoped),
);

it.effect("deduplicates unchanged events but refreshes quiet work before its stale date", () =>
  Effect.gen(function* () {
    const test = yield* setup;
    const service = yield* test.build;
    yield* service.register(sessionId, { activityId: "activity", token });
    yield* service.publish;
    assert.lengthOf(test.deliveries, 1);
    yield* TestClock.adjust("5 minutes");
    yield* service.publish;
    assert.lengthOf(test.deliveries, 2);
  }).pipe(Effect.scoped),
);
