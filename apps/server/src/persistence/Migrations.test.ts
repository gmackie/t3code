import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { migrationManifest, reconcileMigrationLedger, runMigrations } from "./Migrations.ts";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

// Each case gets its own database: OrchestrationV2 is not re-runnable, so a
// shared database would make later ledger rewinds re-run it.
const withFreshDatabase = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  effect.pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" })));

const readLedger = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql<{
    readonly migration_id: number;
    readonly name: string;
    readonly created_at: string;
  }>`SELECT migration_id, name, created_at FROM effect_sql_migrations ORDER BY migration_id`;
});

const assertLedgerMatchesManifest = (throughId = Number.POSITIVE_INFINITY) =>
  Effect.gen(function* () {
    const rows = yield* readLedger;
    assert.deepStrictEqual(
      rows.map((row) => [row.migration_id, row.name]),
      migrationManifest.filter(([id]) => id <= throughId).map(([id, name]) => [id, name]),
    );
  });

const threadColumns = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_threads)`;
  return columns.map((column) => column.name);
});

describe("migration ledger reconciliation", () => {
  it.effect("upgrades a GMACKO ledger from its own numbering onto Orchestration V2", () =>
    withFreshDatabase(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 53 });
        // The lane recorded its thread-import migrations at 50/51 and shifted
        // upstream's 50-53 to 52-55, the ledger installed GMACKO builds carry.
        yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id >= 50`;
        yield* sql`INSERT INTO effect_sql_migrations (migration_id, name, created_at) VALUES
          (50, 'ExternalThreadImports', '2026-09-06 00:00:00'),
          (51, 'ExternalThreadImportEnvironments', '2026-09-06 00:00:00'),
          (52, 'ProjectionThreadPullRequests', '2026-09-07 00:00:00'),
          (53, 'ProjectionThreadMessageContext', '2026-09-08 00:00:00'),
          (54, 'ProjectionThreadTitleState', '2026-09-09 00:00:00'),
          (55, 'PullRequestFilesViewed', '2026-09-10 00:00:00')`;

        yield* runMigrations();

        yield* assertLedgerMatchesManifest();
        const rows = yield* readLedger;
        assert.deepStrictEqual(
          rows.find((row) => row.name === "ProjectionThreadTitleState")?.created_at,
          "2026-09-09 00:00:00",
        );
        assert.isUndefined(rows.find((row) => row.name === "ExternalThreadImports"));
        assert.include(yield* threadColumns, "auto_settle_disabled_at");
      }),
    ),
  );

  it.effect("adds upstream thread columns when lane imports occupied their migration ids", () =>
    withFreshDatabase(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 47 });
        yield* sql`INSERT INTO effect_sql_migrations (migration_id, name, created_at) VALUES
          (48, 'ExternalThreadImports', '2026-09-06 00:00:00'),
          (49, 'ExternalThreadImportEnvironments', '2026-09-06 00:00:00')`;
        yield* runMigrations({ toMigrationInclusive: 53 });
        yield* assertLedgerMatchesManifest(53);
        const columns = yield* threadColumns;
        assert.include(columns, "branch_pull_request_json");
        assert.include(columns, "active_order_key");
      }),
    ),
  );

  it.effect("preserves a title state column installed by the local recovery", () =>
    withFreshDatabase(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 53 });
        yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id >= 52`;
        yield* runMigrations({ toMigrationInclusive: 53 });
        yield* assertLedgerMatchesManifest(53);
        const columns = yield* threadColumns;
        assert.equal(columns.filter((column) => column === "title_state_json").length, 1);
      }),
    ),
  );

  it.effect("leaves an aligned ledger untouched", () =>
    withFreshDatabase(
      Effect.gen(function* () {
        yield* runMigrations();
        const before = yield* readLedger;
        yield* reconcileMigrationLedger();
        const after = yield* readLedger;
        assert.deepStrictEqual(after, before);
      }),
    ),
  );

  it.effect("repairs a lane ledger renumbered by an upstream sync", () =>
    withFreshDatabase(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 45 });

        // A real GMACKO profile after several rebases: lane migrations recorded
        // under stale ids (some twice), lane-only rows the manifest no longer
        // knows, upstream migrations never applied by name, and the schema
        // missing the columns those skipped migrations would have added.
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

        yield* runMigrations({ toMigrationInclusive: 53 });

        yield* assertLedgerMatchesManifest(53);
        const columns = yield* threadColumns;
        assert.include(columns, "linked_pull_request_json");
        assert.include(columns, "unsettled_at");
        // Re-keyed rows keep the application time of their first run.
        const rows = yield* readLedger;
        assert.deepStrictEqual(
          rows.find((row) => row.name === "ProjectionThreadsPinOrderKey")?.created_at,
          "2026-08-08 21:56:11",
        );
      }),
    ),
  );

  it.effect("repairs a ledger where lane migrations once claimed upstream ids", () =>
    withFreshDatabase(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 53 });

        // The nightly profile recorded lane migrations at 36/37, so upstream
        // 036/037 never ran and pinned_at is missing.
        yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id IN (36, 37, 44, 45)`;
        yield* sql`INSERT INTO effect_sql_migrations (migration_id, name, created_at) VALUES
          (36, 'ExternalThreadImports', '2026-08-04 06:57:30'),
          (37, 'ExternalThreadImportEnvironments', '2026-08-04 06:57:30')`;
        yield* sql`ALTER TABLE projection_threads DROP COLUMN pinned_at`;

        yield* runMigrations({ toMigrationInclusive: 53 });

        yield* assertLedgerMatchesManifest(53);
        assert.include(yield* threadColumns, "pinned_at");
      }),
    ),
  );

  it.effect("leaves foreign rows in place so collision checks stay loud", () =>
    withFreshDatabase(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations();

        // Another checkout's migration claimed slot 1. Its code is not ours to
        // re-run and its name is not a known retired lane migration, so the
        // reconciler must not touch the ledger.
        yield* sql`UPDATE effect_sql_migrations
          SET name = 'SomebodyElsesMigration' WHERE migration_id = 1`;
        const before = yield* readLedger;

        yield* reconcileMigrationLedger();

        assert.deepStrictEqual(yield* readLedger, before);
      }),
    ),
  );

  it.effect("does nothing before the ledger table exists", () =>
    withFreshDatabase(
      Effect.gen(function* () {
        yield* reconcileMigrationLedger();
        const sql = yield* SqlClient.SqlClient;
        const tables = yield* sql<{ readonly name: string }>`
          SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
        `;
        assert.strictEqual(tables.length, 0);
      }),
    ),
  );
});
