import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { migrationManifest, reconcileMigrationLedger, runMigrations } from "./Migrations.ts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

const readLedger = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql<{
    readonly migration_id: number;
    readonly name: string;
    readonly created_at: string;
  }>`SELECT migration_id, name, created_at FROM effect_sql_migrations ORDER BY migration_id`;
});

const assertLedgerMatchesManifest = Effect.gen(function* () {
  const rows = yield* readLedger;
  assert.deepStrictEqual(
    rows.map((row) => [row.migration_id, row.name]),
    migrationManifest.map(([id, name]) => [id, name]),
  );
});

layer("migration ledger reconciliation", (it) => {
  it.effect("leaves an aligned ledger untouched", () =>
    Effect.gen(function* () {
      yield* runMigrations();
      const before = yield* readLedger;
      yield* reconcileMigrationLedger();
      const after = yield* readLedger;
      assert.deepStrictEqual(after, before);
    }),
  );

  it.effect("repairs a lane ledger renumbered by an upstream sync", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();

      // The exact ledger of a real GMACKO profile after several rebases:
      // lane migrations recorded under stale ids (some twice, under two
      // different ids), lane-only rows the manifest no longer knows, upstream
      // migrations never applied by name, and the schema missing the columns
      // those skipped migrations would have added.
      yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id >= 33`;
      yield* sql`INSERT INTO effect_sql_migrations (migration_id, name, created_at) VALUES
        (33, 'ProjectionThreadsSettled', '2026-07-28 17:23:21'),
        (34, 'ProjectionThreadsSnoozed', '2026-07-29 19:19:41'),
        (35, 'ProjectionThreadTitleRegeneration', '2026-08-01 04:34:11'),
        (36, 'ExternalThreadImports', '2026-08-02 18:38:14'),
        (37, 'ExternalThreadImportEnvironments', '2026-08-02 18:38:14'),
        (38, 'ProjectionThreadsPinned', '2026-08-05 21:47:22'),
        (39, 'ProjectionThreadsPinOrderKey', '2026-08-08 21:56:11'),
        (40, 'ProjectionProjectFaviconPath', '2026-08-13 05:30:00'),
        (41, 'ExternalThreadImports', '2026-08-13 05:30:00'),
        (42, 'ExternalThreadImportEnvironments', '2026-08-13 05:30:00'),
        (43, 'RepairCustomLocalMigrationSchema', '2026-08-13 07:12:03'),
        (44, 'RepairCustomLocalProjectionIndexes', '2026-08-16 16:57:04'),
        (45, 'AuthSessionClientConnection', '2026-08-23 03:32:22'),
        (99, 'OrchestrationV2Events', '2026-08-23 03:32:22')`;
      yield* sql`ALTER TABLE projection_threads DROP COLUMN linked_pull_request_json`;
      yield* sql`ALTER TABLE projection_threads DROP COLUMN unsettled_at`;

      yield* runMigrations();

      yield* assertLedgerMatchesManifest;
      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      assert.ok(columns.some((column) => column.name === "linked_pull_request_json"));
      assert.ok(columns.some((column) => column.name === "unsettled_at"));
      // Re-keyed rows keep the application time of the first run.
      const rows = yield* readLedger;
      const externalImports = rows.find((row) => row.name === "ExternalThreadImports");
      assert.deepStrictEqual(
        [externalImports?.migration_id, externalImports?.created_at],
        [44, "2026-08-02 18:38:14"],
      );
    }),
  );

  it.effect("repairs a ledger where lane migrations once claimed upstream ids", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();

      // Mimic the nightly profile: lane migrations recorded at 36/37, so
      // upstream 036/037 never ran and pinned_at is missing.
      yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id IN (36, 37, 44, 45)`;
      yield* sql`INSERT INTO effect_sql_migrations (migration_id, name, created_at) VALUES
        (36, 'ExternalThreadImports', '2026-08-04 06:57:30'),
        (37, 'ExternalThreadImportEnvironments', '2026-08-04 06:57:30')`;
      yield* sql`ALTER TABLE projection_threads DROP COLUMN pinned_at`;

      yield* runMigrations();

      yield* assertLedgerMatchesManifest;
      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      assert.ok(columns.some((column) => column.name === "pinned_at"));
    }),
  );
});

layer("migration ledger reconciliation on an empty database", (it) => {
  it.effect("does nothing before the ledger table exists", () =>
    Effect.gen(function* () {
      yield* reconcileMigrationLedger();
      const sql = yield* SqlClient.SqlClient;
      const tables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
      `;
      assert.strictEqual(tables.length, 0);
    }),
  );
});
