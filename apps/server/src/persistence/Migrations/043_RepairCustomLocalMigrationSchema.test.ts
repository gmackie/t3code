import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import Migration0043 from "./043_RepairCustomLocalMigrationSchema.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("043_RepairCustomLocalMigrationSchema", (it) => {
  it.effect("repairs columns skipped by renumbered custom-local migrations", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`CREATE TABLE projection_threads (id TEXT PRIMARY KEY)`;
      yield* sql`CREATE TABLE projection_projects (id TEXT PRIMARY KEY)`;

      yield* Migration0043;

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
