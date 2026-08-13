import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import Migration0042 from "./042_ExternalThreadImportEnvironments.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("042_ExternalThreadImportEnvironments", (it) => {
  it.effect("accepts the schema created by the earlier custom-local migration", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* sql`CREATE TABLE projection_threads (id TEXT PRIMARY KEY)`;
      yield* sql`CREATE TABLE projection_projects (id TEXT PRIMARY KEY)`;
      yield* sql`
        CREATE TABLE projection_external_thread_imports (
          thread_id TEXT PRIMARY KEY,
          provider_instance_id TEXT NOT NULL,
          provider_driver TEXT NOT NULL,
          continuation_group TEXT NOT NULL,
          native_thread_id TEXT NOT NULL,
          original_cwd TEXT NOT NULL,
          resume_cursor_json TEXT,
          decoder_version TEXT NOT NULL,
          imported_at TEXT NOT NULL,
          event_sequence INTEGER NOT NULL,
          environment_id TEXT NOT NULL DEFAULT 'local'
        )
      `;
      yield* sql`
        CREATE UNIQUE INDEX uq_external_thread_import_identity
        ON projection_external_thread_imports (
          environment_id,
          continuation_group,
          provider_instance_id,
          provider_driver,
          native_thread_id
        )
      `;

      yield* Migration0042;

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_external_thread_imports)
      `;
      assert.equal(columns.filter((column) => column.name === "environment_id").length, 1);

      const threadColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      assert.ok(threadColumns.some((column) => column.name === "pin_order_key"));

      const projectColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_projects)
      `;
      assert.ok(projectColumns.some((column) => column.name === "default_thread_env_mode"));
    }),
  );
});
