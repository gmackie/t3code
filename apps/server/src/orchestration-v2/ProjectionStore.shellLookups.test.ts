import { assert, it } from "@effect/vitest";
import {
  EventId,
  MessageId,
  NodeId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2AppThread,
  type OrchestrationV2Run,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as Tracer from "effect/Tracer";
import * as Persistence from "../persistence/Layers/Sqlite.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

const layer = ProjectionStore.layer.pipe(Layer.provideMerge(Persistence.layerMemory));
const now = DateTime.makeUnsafe("2026-10-10T12:00:00Z");
const later = DateTime.add(now, { minutes: 1 });
const threadId = ThreadId.make("thread:bounded-shell");
const providerInstanceId = ProviderInstanceId.make("codex");

const seedThread = Effect.gen(function* () {
  const store = yield* ProjectionStore.ProjectionStoreV2;
  const payload: OrchestrationV2AppThread = {
    id: threadId,
    projectId: ProjectId.make("project:bounded-shell"),
    title: "Bounded shell",
    createdBy: "user",
    creationSource: "web",
    providerInstanceId,
    modelSelection: { instanceId: providerInstanceId, model: "test" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
    forkedFrom: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  };
  yield* store.apply({
    id: EventId.make("thread-created"),
    type: "thread.created",
    threadId,
    occurredAt: now,
    payload,
  });
});

const seedRun = Effect.fn(function* (
  name: string,
  status: OrchestrationV2Run["status"],
  ordinal: number,
) {
  const store = yield* ProjectionStore.ProjectionStoreV2;
  const id = RunId.make(name);
  yield* store.apply({
    id: EventId.make(`event:${name}`),
    type: "run.created",
    threadId,
    occurredAt: now,
    payload: {
      id,
      threadId,
      ordinal,
      providerInstanceId,
      modelSelection: { instanceId: providerInstanceId, model: "test" },
      providerThreadId: null,
      userMessageId: MessageId.make(`message:${name}`),
      rootNodeId: NodeId.make(`node:${name}`),
      activeAttemptId: null,
      status,
      requestedAt: now,
      startedAt: now,
      completedAt: status === "completed" || status === "failed" ? now : null,
      checkpointId: null,
      contextHandoffId: null,
    },
  });
  return id;
});

const secret = (
  name: string,
  runId: RunId,
  updatedAt = now,
): Extract<OrchestrationV2TurnItem, { type: "secret_request" }> => ({
  id: TurnItemId.make(name),
  threadId,
  runId,
  nodeId: NodeId.make(`node:${runId}`),
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal: 1,
  type: "secret_request",
  status: "waiting",
  title: null,
  startedAt: now,
  completedAt: null,
  updatedAt,
  label: name,
  reason: "Test request",
  secretStatus: "pending",
});
const saveItem = Effect.fn(function* (payload: OrchestrationV2TurnItem) {
  yield* (yield* ProjectionStore.ProjectionStoreV2).apply({
    id: EventId.make(`event:${payload.id}:${payload.status}`),
    type: "turn-item.updated",
    threadId,
    occurredAt: payload.updatedAt,
    payload,
  });
});

it.effect("bounds shell lookups to relevant indexed rows, not thread history", () =>
  Effect.gen(function* () {
    yield* seedThread;
    const store = yield* ProjectionStore.ProjectionStoreV2;
    const sql = yield* SqlClient.SqlClient;
    let shellQuery: string | undefined;
    const tracer = Tracer.make({
      span(options) {
        const span = new Tracer.NativeSpan(options);
        const end = span.end.bind(span);
        span.end = (time, exit) => {
          end(time, exit);
          const query = span.attributes.get("db.query.text");
          if (typeof query === "string" && query.includes("AS pending_secret_request_payload_json"))
            shellQuery = query;
        };
        return span;
      },
    });
    yield* store.getShellSnapshot().pipe(Effect.withTracer(tracer));
    assert.isDefined(shellQuery);
    const plan = yield* sql.unsafe<{ detail: string }>(`EXPLAIN QUERY PLAN ${shellQuery}`);
    const details = plan.map((row) => row.detail).join("\n");
    assert.include(details, "orchestration_v2_projection_turn_items_waiting_secret_idx");
    assert.include(details, "orchestration_v2_projection_turn_items_failed_error_idx");
    assert.include(details, "orchestration_v2_projection_messages_latest_authored_idx");
    assert.notInclude(
      details,
      "SEARCH secret USING INDEX orchestration_v2_projection_turn_items_thread_run_idx",
    );
    assert.notInclude(
      details,
      "SEARCH item USING INDEX orchestration_v2_projection_turn_items_thread_run_idx",
    );
  }).pipe(Effect.provide(layer)),
);

it.effect("keeps only waiting secrets from active runs and removes resolved requests", () =>
  Effect.gen(function* () {
    yield* seedThread;
    const store = yield* ProjectionStore.ProjectionStoreV2;
    const finished = yield* seedRun("finished", "completed", 1);
    const active = yield* seedRun("active", "waiting", 2);
    const second = yield* seedRun("second", "running", 3);
    yield* saveItem(secret("stale-finished", finished, later));
    yield* saveItem(secret("older-active", active));
    yield* saveItem(secret("tie-a", active, later));
    yield* saveItem(secret("tie-z", second, later));
    let shell = (yield* store.getShellSnapshot()).threads[0]!;
    assert.equal(shell.pendingRuntimeRequest?.id, "tie-z");
    assert.equal((yield* store.getThreadShell(threadId))?.pendingRuntimeRequest?.id, "tie-z");
    yield* saveItem({
      ...secret("tie-z", second, later),
      status: "completed",
      secretStatus: "saved",
    });
    shell = (yield* store.getShellSnapshot()).threads[0]!;
    assert.equal(shell.pendingRuntimeRequest?.id, "tie-a");
    yield* saveItem({
      ...secret("tie-a", active, later),
      status: "cancelled",
      secretStatus: "cancelled",
    });
    yield* saveItem({
      ...secret("older-active", active),
      status: "cancelled",
      secretStatus: "cancelled",
    });
    assert.isNull((yield* store.getShellSnapshot()).threads[0]!.pendingRuntimeRequest);
  }).pipe(Effect.provide(layer)),
);

it.effect("preserves the newest root failure while ignoring other nodes and resolved errors", () =>
  Effect.gen(function* () {
    yield* seedThread;
    const store = yield* ProjectionStore.ProjectionStoreV2;
    const runId = yield* seedRun("failed", "failed", 1);
    const error = (name: string, updatedAt = now): OrchestrationV2TurnItem => ({
      ...secret(name, runId, updatedAt),
      type: "error",
      status: "failed",
      failure: { class: "unknown", message: name, code: null, retryable: null },
    });
    yield* saveItem(error("old"));
    yield* saveItem(error("latest", later));
    yield* saveItem({ ...error("other-node", later), nodeId: NodeId.make("child") });
    yield* saveItem({ ...error("resolved", later), status: "completed" });
    assert.equal((yield* store.getShellSnapshot()).threads[0]!.lastError, "latest");
    assert.equal((yield* store.getThreadShell(threadId))?.lastError, "latest");
  }).pipe(Effect.provide(layer)),
);

it.effect("finds the latest human-authored message without confusing scheduled messages", () =>
  Effect.gen(function* () {
    yield* seedThread;
    const store = yield* ProjectionStore.ProjectionStoreV2;
    const message = (id: string, createdBy: "user" | "agent", updatedAt = now) => ({
      id: MessageId.make(id),
      threadId,
      runId: null,
      nodeId: null,
      role: "user" as const,
      text: id,
      attachments: [],
      streaming: false,
      createdBy,
      creationSource: "web" as const,
      createdAt: now,
      updatedAt,
    });
    for (const payload of [message("human", "user"), message("scheduled", "agent", later)]) {
      yield* store.apply({
        id: EventId.make(payload.id),
        type: "message.updated",
        threadId,
        occurredAt: payload.updatedAt,
        payload,
      });
    }
    let shell = (yield* store.getShellSnapshot()).threads[0]!;
    assert.equal(DateTime.formatIso(shell.latestUserMessageAt!), DateTime.formatIso(later));
    assert.equal(DateTime.formatIso(shell.latestUserAuthoredMessageAt!), DateTime.formatIso(now));
    yield* store.apply({
      id: EventId.make("human-edited"),
      type: "message.updated",
      threadId,
      occurredAt: later,
      payload: message("human", "user", later),
    });
    shell = (yield* store.getShellSnapshot()).threads[0]!;
    assert.equal(DateTime.formatIso(shell.latestUserAuthoredMessageAt!), DateTime.formatIso(later));
  }).pipe(Effect.provide(layer)),
);
