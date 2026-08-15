import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("044_RepairCustomLocalProjectionIndexes", (it) => {
  it.effect("restores ordering indexes skipped by custom-local migration id collisions", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 28 });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (29, 'CanonicalizeModelSelectionProviderInstanceIds')
      `;
      yield* runMigrations({ toMigrationInclusive: 44 });

      const indexes = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM sqlite_master
        WHERE type = 'index'
      `;
      const indexNames = new Set(indexes.map((index) => index.name));
      assert.isTrue(indexNames.has("idx_projection_thread_activities_thread_sequence_created_id"));
      assert.isTrue(indexNames.has("idx_projection_thread_messages_thread_created_id"));
      assert.isTrue(indexNames.has("idx_projection_threads_shell_active"));
      assert.isTrue(indexNames.has("idx_projection_threads_shell_archived"));
      assert.isTrue(indexNames.has("idx_projection_turns_thread_keyset"));
      assert.isTrue(indexNames.has("idx_projection_thread_activities_thread_kind_created_id"));
    }),
  );
});
