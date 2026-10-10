import { assert, it } from "@effect/vitest";
import {
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2AppThread,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Tracer from "effect/Tracer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as Persistence from "../persistence/Layers/Sqlite.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

const encodeSessionError = Schema.encodeSync(
  Schema.fromJsonString(Schema.Struct({ lastError: Schema.String })),
);

const layer = ProjectionStore.layer.pipe(Layer.provideMerge(Persistence.layerMemory));

it.effect(
  "starts shell error lookups from thread bindings while preserving latest matching sessions",
  () =>
    Effect.gen(function* () {
      const store = yield* ProjectionStore.ProjectionStoreV2;
      const sql = yield* SqlClient.SqlClient;
      const now = yield* DateTime.now;
      const provider = ProviderInstanceId.make("codex");
      const threadIds = ["first", "shared", "unbound"].map((name) =>
        ThreadId.make(`thread:session-lookup:${name}`),
      );
      for (const id of threadIds) {
        const payload: OrchestrationV2AppThread = {
          createdBy: "user",
          creationSource: "web",
          id,
          projectId: ProjectId.make("project:session-lookup"),
          title: "Session lookup",
          providerInstanceId: provider,
          modelSelection: { instanceId: provider, model: "gpt-5.4" },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          activeProviderThreadId: null,
          lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: id },
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
          id: EventId.make(`event:session-lookup:${id}`),
          type: "thread.created",
          threadId: id,
          occurredAt: now,
          payload,
        });
      }
      const sessions = [
        { id: "old", provider: "codex", updated: "2026-01-01", error: "old error" },
        { id: "tie-a", provider: "codex", updated: "2026-01-02", error: "tie a" },
        { id: "tie-z", provider: "codex", updated: "2026-01-02", error: "latest matching" },
        {
          id: "wrong-provider",
          provider: "claude",
          updated: "2026-01-03",
          error: "wrong provider",
        },
        { id: "unbound-newest", provider: "codex", updated: "2026-01-04", error: "unbound" },
      ];
      for (const session of sessions) {
        yield* sql`INSERT INTO orchestration_v2_projection_provider_sessions
        (provider_session_id, provider, provider_instance_id, status, updated_at, payload_json)
        VALUES (${session.id}, ${session.provider}, ${session.provider}, 'error', ${session.updated}, ${encodeSessionError({ lastError: session.error })})`;
        if (session.id !== "unbound-newest") {
          yield* sql`INSERT INTO orchestration_v2_projection_provider_session_bindings VALUES (${session.id}, ${threadIds[0]})`;
        }
      }
      yield* sql`INSERT INTO orchestration_v2_projection_provider_session_bindings VALUES ('tie-z', ${threadIds[1]})`;
      let shellQuery: string | undefined;
      const tracer = Tracer.make({
        span(options) {
          const span = new Tracer.NativeSpan(options);
          const end = span.end.bind(span);
          span.end = (time, exit) => {
            end(time, exit);
            const query = span.attributes.get("db.query.text");
            if (typeof query === "string" && query.includes("AS last_error")) shellQuery = query;
          };
          return span;
        },
      });
      const shell = yield* store.getShellSnapshot().pipe(Effect.withTracer(tracer));
      assert.deepEqual(
        shell.threads.map((thread) => thread.lastError),
        ["latest matching", "latest matching", null],
      );
      assert.isDefined(shellQuery);
      const plan = yield* sql.unsafe<{ detail: string }>(`EXPLAIN QUERY PLAN ${shellQuery}`);
      assert.isTrue(
        plan.some((row) =>
          row.detail.includes(
            "SEARCH binding USING INDEX orchestration_v2_projection_provider_session_bindings_thread_idx",
          ),
        ),
      );
      assert.isFalse(
        plan.some((row) =>
          row.detail.includes(
            "SEARCH session USING INDEX orchestration_v2_projection_provider_sessions_instance_status_idx",
          ),
        ),
      );
    }).pipe(Effect.provide(layer)),
);
