import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import { runMigrations } from "../Migrations.ts";

it.effect("upgrades an existing database with bounded shell lookup indexes exactly once", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 58 });
    yield* sql`INSERT INTO orchestration_v2_projection_messages
      (message_id, thread_id, run_id, node_id, role, streaming, created_at, updated_at, payload_json)
      VALUES ('existing-user', 'thread', NULL, NULL, 'user', 0, '2026-01-01', '2026-01-01', '{"createdBy":"user"}')`;
    const ran = yield* runMigrations();
    assert.deepEqual(ran, [[59, "BoundedShellLookups"]]);
    assert.deepEqual(yield* runMigrations(), []);
    const rows = yield* sql<{ message_id: string }>`
      SELECT message_id FROM orchestration_v2_projection_messages
        INDEXED BY orchestration_v2_projection_messages_latest_authored_idx
      WHERE thread_id = 'thread' AND role = 'user' AND json_extract(payload_json, '$.createdBy') = 'user'
      ORDER BY updated_at DESC, message_id DESC LIMIT 1
    `;
    assert.deepEqual(rows, [{ message_id: "existing-user" }]);
    assert.deepEqual(yield* sql`PRAGMA quick_check`, [{ quick_check: "ok" }]);
  }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
);
