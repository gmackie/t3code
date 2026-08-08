import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()))(
  "projection thread pin order migration",
  (it) => {
    it.effect("adds the pin order column required by projection queries", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations();
        const columns = yield* sql<{ readonly name: string }>`
          PRAGMA table_info(projection_threads)
        `;
        assert.isTrue(columns.some((column) => column.name === "pin_order_key"));
      }),
    );
  },
);
