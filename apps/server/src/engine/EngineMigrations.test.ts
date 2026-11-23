import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

import { runEngineMigrations } from "./EngineMigrations.ts";

it.effect("concurrent engine services initialize a fresh database once", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped();
    yield* Effect.gen(function* () {
      yield* Effect.all([runEngineMigrations(), runEngineMigrations()], {
        concurrency: "unbounded",
      });
      const sql = yield* SqlClient.SqlClient;
      const applied = yield* sql<{ readonly id: number; readonly name: string }>`
        SELECT id, name FROM engine_schema_migrations ORDER BY id
      `;
      assert.deepStrictEqual(applied, [
        { id: 1, name: "Journal" },
        { id: 2, name: "EffectLane" },
      ]);
      yield* sql`SELECT * FROM engine_events`;
      yield* sql`SELECT * FROM engine_effects`;
    }).pipe(
      Effect.provide(
        NodeSqliteClient.layer({
          filename: path.join(directory, "state.sqlite"),
          writerWorker: true,
        }),
      ),
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
