import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()))(
  "external thread import migrations",
  (it) => {
    it.effect("upgrades the applied 041 schema without losing provenance", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 41 });
        yield* sql`
        INSERT INTO projection_external_thread_imports (
          thread_id, provider_instance_id, provider_driver, continuation_group,
          native_thread_id, original_cwd, resume_cursor_json, decoder_version,
          imported_at, event_sequence
        ) VALUES (
          'thread-old', 'codex', 'codex', 'home:test', 'native-old', '/tmp/test',
          '{"threadId":"native-old"}', 'codex-v1', '2026-01-01T00:00:00.000Z', 7
        )
      `;
        yield* runMigrations({ toMigrationInclusive: 42 });
        const indexes = yield* sql<{ name: string; unique: number }>`
        PRAGMA index_list(projection_external_thread_imports)
      `;
        assert.ok(
          indexes.some(
            (index) => index.name === "uq_external_thread_import_identity" && index.unique === 1,
          ),
        );
        const columns = yield* sql<{ name: string }>`
        PRAGMA index_info('uq_external_thread_import_identity')
      `;
        assert.deepStrictEqual(
          columns.map((column) => column.name),
          [
            "environment_id",
            "continuation_group",
            "provider_instance_id",
            "provider_driver",
            "native_thread_id",
          ],
        );
        const preserved = yield* sql<{ threadId: string; environmentId: string }>`
        SELECT thread_id AS "threadId", environment_id AS "environmentId"
        FROM projection_external_thread_imports
      `;
        assert.deepStrictEqual(preserved, [{ threadId: "thread-old", environmentId: "local" }]);
        yield* sql`
        INSERT INTO projection_external_thread_imports (
          thread_id, environment_id, provider_instance_id, provider_driver, continuation_group,
          native_thread_id, original_cwd, resume_cursor_json, decoder_version,
          imported_at, event_sequence
        ) VALUES (
          'thread-remote', 'remote', 'codex', 'codex', 'home:test', 'native-old', '/tmp/test',
          NULL, 'codex-v1', '2026-01-01T00:00:00.000Z', 8
        )
      `;
        const duplicate = yield* sql<{ threadId: string }>`
        SELECT thread_id AS "threadId" FROM projection_external_thread_imports
        WHERE environment_id = 'local' AND continuation_group = 'home:test'
          AND provider_instance_id = 'codex' AND provider_driver = 'codex'
          AND native_thread_id = 'native-old'
      `;
        assert.deepStrictEqual(duplicate, [{ threadId: "thread-old" }]);
      }),
    );
  },
);
