import { assert, describe, it } from "@effect/vitest";
import {
  AuthOrchestrationReadScope,
  AuthSessionId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  RuntimeRequestId,
  EnvironmentId,
  ThreadId,
  type AuthClientSession,
} from "@t3tools/contracts";
import type { AgentAwarenessState } from "@t3tools/shared/agentAwareness";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { v2PullRequestThread } from "../orchestration-v2/testkit/pullRequestFixtures.ts";
import * as AgentNotificationWorker from "./AgentNotificationWorker.ts";
import * as TestClock from "effect/testing/TestClock";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as SessionStore from "../auth/SessionStore.ts";
import * as ExpoPush from "./ExpoPush.ts";

const sessionId = AuthSessionId.make("phone");
const token = "ExponentPushToken[phone]";
const state: AgentAwarenessState = {
  environmentId: EnvironmentId.make("env"),
  threadId: ThreadId.make("thread"),
  projectTitle: "Project",
  threadTitle: "Task",
  phase: "completed",
  headline: "Agent finished",
  modelTitle: "model",
  updatedAt: "2026-01-01T00:00:00Z",
  deepLink: "/threads/env/thread",
};
const setup = Effect.fnUntraced(function* () {
  const now = yield* DateTime.now;
  const values = new Map<string, Uint8Array>();
  const active: AuthClientSession[] = [
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
  ];
  const requests: Array<{ url: string; body: unknown }> = [];
  let response: () => Response = () => Response.json({ data: { status: "ok", id: "ticket" } });
  const fetch: typeof globalThis.fetch = Object.assign(
    (
      input: Parameters<typeof globalThis.fetch>[0],
      init?: Parameters<typeof globalThis.fetch>[1],
    ) => {
      const body = init?.body;
      requests.push({
        url: String(input),
        body: JSON.parse(
          typeof body === "string" ? body : new TextDecoder().decode(body as Uint8Array),
        ),
      });
      return Promise.resolve(response());
    },
    { preconnect: () => {} },
  );
  const dependencies = Layer.mergeAll(
    Layer.mock(ServerSecretStore.ServerSecretStore)({
      get: (name) => Effect.sync(() => Option.fromUndefinedOr(values.get(name))),
      set: (name, value) =>
        Effect.sync(() => {
          values.set(name, value);
        }),
    }),
    Layer.mock(SessionStore.SessionStore)({
      cookieName: "test",
      legacyCookieName: undefined,
      listActive: () => Effect.succeed(active),
    }),
    Layer.succeed(FetchHttpClient.Fetch, fetch),
  );
  const build = Effect.gen(function* () {
    const context = yield* Layer.build(ExpoPush.layer.pipe(Layer.provide(dependencies)));
    return Context.get(context, ExpoPush.ExpoPush);
  });
  const service = yield* build;
  return {
    service,
    build,
    requests,
    active,
    respond: (next: () => Response) => {
      response = next;
    },
    now: now.epochMilliseconds,
  };
});

describe("Expo push delivery", () => {
  it.effect("sends actionable alerts with navigation data and deduplicates across restarts", () =>
    Effect.gen(function* () {
      const test = yield* setup();
      yield* test.service.register(sessionId, { token });
      yield* test.service.publish({ ...state, phase: "running" }, "running", test.now);
      yield* test.service.publish(state, "run-1:completed", test.now);
      yield* test.service.publish(state, "run-1:completed", test.now);
      const restarted = yield* test.build;
      yield* restarted.publish(state, "run-1:completed", test.now);
      assert.lengthOf(test.requests, 1);
      assert.deepEqual(test.requests[0]?.body, {
        to: token,
        title: "Agent finished",
        body: "Project · Task",
        sound: "default",
        ttl: 300,
        data: { environmentId: "env", threadId: "thread", deepLink: "/threads/env/thread" },
      });
      yield* restarted.publish(state, "run-2:completed", test.now);
      assert.lengthOf(test.requests, 2);
    }).pipe(Effect.scoped),
  );

  it.effect("does not replay activity from before registration", () =>
    Effect.gen(function* () {
      const test = yield* setup();
      yield* test.service.register(sessionId, { token });
      yield* test.service.publish(state, "old-run", test.now - 1);
      assert.lengthOf(test.requests, 0);
    }).pipe(Effect.scoped),
  );

  it.effect("disabling and session revocation stop delivery", () =>
    Effect.gen(function* () {
      const test = yield* setup();
      yield* test.service.register(sessionId, { token });
      yield* test.service.register(sessionId, { token: null });
      yield* test.service.publish(state, "run-1", test.now);
      yield* test.service.register(sessionId, { token });
      test.active.splice(0);
      yield* test.service.publish(state, "run-2", test.now);
      assert.lengthOf(test.requests, 0);
    }).pipe(Effect.scoped),
  );

  it.effect("removes tokens rejected by Expo", () =>
    Effect.gen(function* () {
      const test = yield* setup();
      test.respond(() =>
        Response.json({ data: { status: "error", details: { error: "DeviceNotRegistered" } } }),
      );
      yield* test.service.register(sessionId, { token });
      yield* test.service.publish(state, "run-1", test.now);
      yield* test.service.publish(state, "run-2", test.now);
      assert.lengthOf(test.requests, 1);
    }).pipe(Effect.scoped),
  );

  it.effect("keeps successful devices deduplicated when another delivery fails", () =>
    Effect.gen(function* () {
      const test = yield* setup();
      const second = AuthSessionId.make("second-phone");
      test.active.push({ ...test.active[0]!, sessionId: second });
      yield* test.service.register(sessionId, { token });
      yield* test.service.register(second, { token: "ExpoPushToken[second]" });
      let attempt = 0;
      test.respond(() =>
        ++attempt === 1
          ? new Response("unavailable", { status: 503 })
          : Response.json({ data: { status: "ok", id: "ticket" } }),
      );
      const failed = yield* Effect.result(test.service.publish(state, "run-1", test.now));
      assert.equal(failed._tag, "Failure");
      assert.lengthOf(test.requests, 2);
      const restarted = yield* test.build;
      yield* restarted.publish(state, "run-1", test.now);
      assert.lengthOf(test.requests, 3);
      assert.propertyVal(test.requests[2]!.body, "to", token);
    }).pipe(Effect.scoped),
  );

  it.effect("moves a re-paired phone to its new session without duplicate alerts", () =>
    Effect.gen(function* () {
      const test = yield* setup();
      const second = AuthSessionId.make("new-pairing");
      test.active.push({ ...test.active[0]!, sessionId: second });
      yield* test.service.register(sessionId, { token });
      yield* test.service.register(second, { token });
      yield* test.service.publish(state, "run-1", test.now);
      assert.lengthOf(test.requests, 1);
      yield* test.service.register(second, { token: null });
      yield* test.service.publish(state, "run-2", test.now);
      assert.lengthOf(test.requests, 1);
    }).pipe(Effect.scoped),
  );

  it.effect("checks receipts and stops sending to unregistered devices", () =>
    Effect.gen(function* () {
      const test = yield* setup();
      yield* test.service.register(sessionId, { token });
      yield* test.service.publish(state, "run-1", test.now);
      yield* TestClock.adjust("15 minutes");
      test.respond(() =>
        Response.json({
          data: { ticket: { status: "error", details: { error: "DeviceNotRegistered" } } },
        }),
      );
      yield* test.service.checkReceipts;
      yield* test.service.publish(state, "run-2", test.now);
      assert.lengthOf(test.requests, 2);
      assert.include(test.requests[1]!.url, "getReceipts");
    }).pipe(Effect.scoped),
  );
});

it.effect(
  "projects thread activity into alerts and excludes archived, child, and historical work",
  () =>
    Effect.gen(function* () {
      const test = yield* setup();
      yield* test.service.register(sessionId, { token });
      const date = DateTime.makeUnsafe(test.now);
      const iso = DateTime.formatIso(date);
      const projectId = ProjectId.make("project");
      let thread = {
        ...v2PullRequestThread({
          id: state.threadId,
          projectId,
          title: "Task",
          modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          pullRequests: [],
          latestUserMessageAt: null,
          createdAt: iso,
          updatedAt: iso,
          archivedAt: null,
          settledOverride: null,
          settledAt: null,
        }),
        latestRunId: RunId.make("run-1"),
        latestRunCompletedAt: date,
      };
      const worker = yield* AgentNotificationWorker.make.pipe(
        Effect.provideService(ExpoPush.ExpoPush, test.service),
        Effect.provide(
          Layer.mergeAll(
            Layer.mock(ThreadManagement.ThreadManagementService)({
              getThreadShell: () => Effect.sync(() => thread),
              streamDomainEvents: Stream.empty,
              streamStoredEvents: Stream.empty,
            }),
            Layer.mock(ProjectService.ProjectService)({
              snapshot: Effect.die("unused"),
              getById: () =>
                Effect.succeedSome({
                  id: projectId,
                  title: "Project",
                  workspaceRoot: "/project",
                  defaultModelSelection: null,
                  scripts: [],
                  createdAt: iso,
                  updatedAt: iso,
                  deletedAt: null,
                }),
            }),
            Layer.mock(ServerEnvironment.ServerEnvironment)({
              getEnvironmentId: Effect.succeed(state.environmentId),
              getDescriptor: Effect.die("unused"),
            }),
          ),
        ),
      );
      thread = {
        ...thread,
        status: "completed",
        latestRunCompletedAt: DateTime.makeUnsafe(test.now - 1),
      };
      yield* worker.enqueue(thread.id);
      yield* worker.drain;
      assert.lengthOf(test.requests, 0);
      thread = { ...thread, latestRunCompletedAt: date, archivedAt: date };
      yield* worker.enqueue(thread.id);
      yield* worker.drain;
      assert.lengthOf(test.requests, 0);
      thread = {
        ...thread,
        archivedAt: null,
        lineage: { ...thread.lineage, relationshipToParent: "subagent" },
      };
      yield* worker.enqueue(thread.id);
      yield* worker.drain;
      assert.lengthOf(test.requests, 0);
      thread = {
        ...thread,
        lineage: { ...thread.lineage, relationshipToParent: null },
        pendingRuntimeRequest: {
          id: RuntimeRequestId.make("question"),
          kind: "user_input",
          createdAt: date,
        },
      };
      yield* worker.enqueue(thread.id);
      yield* worker.drain;
      assert.lengthOf(test.requests, 1);
      thread = { ...thread, pendingRuntimeRequest: null };
      yield* worker.enqueue(thread.id);
      yield* worker.drain;
      yield* worker.enqueue(thread.id);
      yield* worker.drain;
      assert.lengthOf(test.requests, 2);
    }).pipe(Effect.scoped),
);
