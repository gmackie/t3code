import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import {
  EngineEventId,
  EngineName,
  PrincipalId,
  TenantId,
  type PrincipalRef,
} from "@t3tools/engine/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import * as EngineJournal from "./EngineJournal.ts";
import { runEngineMigrations } from "./EngineMigrations.ts";
import * as EngineWriteBudget from "./EngineWriteBudget.ts";

const tenant = Schema.decodeSync(TenantId)("local");
const otherTenant = Schema.decodeSync(TenantId)("other");
const owner: PrincipalRef = {
  tenantId: tenant,
  principalId: Schema.decodeSync(PrincipalId)("owner"),
  kind: "human",
};
const eventId = Schema.decodeSync(EngineEventId);
const name = Schema.decodeSync(EngineName);

const event = (id: string, payload: unknown = { id }) => ({
  eventId: eventId(id),
  type: name("run.created"),
  actor: owner,
  occurredAt: "2026-10-21T10:00:00.000Z",
  payload,
});

const TestLayer = EngineJournal.layer.pipe(
  Layer.provide(EngineWriteBudget.layer),
  Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
);

it.layer(TestLayer)("EngineJournal", (it) => {
  it.effect("appends at the expected version and reads the stream back in order", () =>
    Effect.gen(function* () {
      const journal = yield* EngineJournal.EngineJournal;
      const first = yield* journal.commit({
        tenantId: tenant,
        streamId: "run-ordered",
        expectedVersion: 0,
        idempotencyKey: "create-ordered",
        commandType: "run.create",
        events: [event("e-1"), event("e-2")],
      });
      assert.deepStrictEqual(first, { streamVersion: 2, replayed: false });

      const events = yield* journal.read({
        tenantId: tenant,
        streamId: "run-ordered",
        afterVersion: 0,
        limit: 10,
      });
      assert.deepStrictEqual(
        events.map((e) => [e.streamVersion, e.eventId]),
        [
          [1, "e-1"],
          [2, "e-2"],
        ],
      );
    }),
  );

  it.effect("rejects a stale expected version and writes nothing", () =>
    Effect.gen(function* () {
      const journal = yield* EngineJournal.EngineJournal;
      yield* journal.commit({
        tenantId: tenant,
        streamId: "run-stale",
        expectedVersion: 0,
        idempotencyKey: "stale-1",
        commandType: "run.create",
        events: [event("s-1")],
      });
      const error = yield* journal
        .commit({
          tenantId: tenant,
          streamId: "run-stale",
          expectedVersion: 0,
          idempotencyKey: "stale-2",
          commandType: "run.cancel",
          events: [event("s-2")],
        })
        .pipe(Effect.flip);
      assert.strictEqual(error._tag, "EngineRevisionConflict");

      const events = yield* journal.read({
        tenantId: tenant,
        streamId: "run-stale",
        afterVersion: 0,
        limit: 10,
      });
      assert.strictEqual(events.length, 1);
      const sql = yield* SqlClient.SqlClient;
      const receipts = yield* sql<{ readonly n: number }>`
        SELECT COUNT(*) AS n FROM engine_command_receipts WHERE idempotency_key = 'stale-2'
      `;
      assert.strictEqual(receipts[0]?.n, 0);
    }),
  );

  it.effect("replays a committed idempotency key without writing again", () =>
    Effect.gen(function* () {
      const journal = yield* EngineJournal.EngineJournal;
      const input = {
        tenantId: tenant,
        streamId: "run-retry",
        expectedVersion: 0,
        idempotencyKey: "retry-create",
        commandType: "run.create",
        events: [event("r-1")],
      };
      yield* journal.commit(input);
      // A retry after a lost response still carries the version it decided against.
      const replay = yield* journal.commit({ ...input, events: [event("r-1-retry")] });
      assert.deepStrictEqual(replay, { streamVersion: 1, replayed: true });

      const events = yield* journal.read({
        tenantId: tenant,
        streamId: "run-retry",
        afterVersion: 0,
        limit: 10,
      });
      assert.deepStrictEqual(
        events.map((e) => e.eventId),
        ["r-1"],
      );
    }),
  );

  it.effect("refuses an idempotency key reused for another command", () =>
    Effect.gen(function* () {
      const journal = yield* EngineJournal.EngineJournal;
      yield* journal.commit({
        tenantId: tenant,
        streamId: "run-key",
        expectedVersion: 0,
        idempotencyKey: "shared-key",
        commandType: "run.create",
        events: [event("k-1")],
      });
      const error = yield* journal
        .commit({
          tenantId: tenant,
          streamId: "run-other",
          expectedVersion: 0,
          idempotencyKey: "shared-key",
          commandType: "run.create",
          events: [event("k-2")],
        })
        .pipe(Effect.flip);
      assert.strictEqual(error._tag, "EngineIdempotencyConflict");
    }),
  );

  it.effect("keeps tenants' streams and keys apart", () =>
    Effect.gen(function* () {
      const journal = yield* EngineJournal.EngineJournal;
      for (const tenantId of [tenant, otherTenant]) {
        const result = yield* journal.commit({
          tenantId,
          streamId: "run-shared-name",
          expectedVersion: 0,
          idempotencyKey: "same-key",
          commandType: "run.create",
          events: [event(`t-${tenantId}`)],
        });
        assert.deepStrictEqual(result, { streamVersion: 1, replayed: false });
      }
      const otherEvents = yield* journal.read({
        tenantId: otherTenant,
        streamId: "run-shared-name",
        afterVersion: 0,
        limit: 10,
      });
      assert.deepStrictEqual(
        otherEvents.map((e) => e.eventId),
        ["t-other"],
      );
    }),
  );

  it.effect("refuses a commit larger than the per-transaction row cap", () =>
    Effect.gen(function* () {
      const journal = yield* EngineJournal.EngineJournal;
      const error = yield* journal
        .commit({
          tenantId: tenant,
          streamId: "run-large",
          expectedVersion: 0,
          idempotencyKey: "large",
          commandType: "run.create",
          events: Array.from({ length: EngineJournal.MAX_ENGINE_COMMIT_ROWS }, (_, n) =>
            event(`large-${n}`),
          ),
        })
        .pipe(Effect.flip);
      assert.strictEqual(error._tag, "EngineCommitTooLarge");
    }),
  );

  it.effect("re-running engine migrations is a no-op", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const ledger = sql<{
        readonly id: number;
        readonly name: string;
        readonly appliedAt: string;
      }>`
        SELECT id, name, applied_at AS "appliedAt" FROM engine_schema_migrations ORDER BY id
      `;
      const before = yield* ledger;
      yield* runEngineMigrations();
      assert.isAbove(before.length, 0);
      assert.deepStrictEqual(yield* ledger, before);
    }),
  );
});
