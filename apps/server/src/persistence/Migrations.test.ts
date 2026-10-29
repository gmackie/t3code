import { assert, describe, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";

import { migrationManifest, reconcileMigrationLedger, runMigrations } from "./Migrations.ts";
import BoundedShellLookups from "./Migrations/059_BoundedShellLookups.ts";
import BobExecutionAdmission from "./Migrations/063_BobExecutionAdmission.ts";
import PeerLinks from "./Migrations/070_PeerLinks.ts";
import PeerLinkFence from "./Migrations/071_PeerLinkFence.ts";
import WaitingLinkRequestIndex from "./Migrations/072_WaitingLinkRequestIndex.ts";

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

  it.effect("upgrades a custom-local profile after upstream claimed 62 and 63", () =>
    withFreshDatabase(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 61 });
        // custom-local released its lane migrations as 62 and 63.
        yield* BoundedShellLookups;
        yield* BobExecutionAdmission;
        yield* sql`INSERT INTO effect_sql_migrations (migration_id, name, created_at) VALUES
          (62, 'BoundedShellLookups', '2026-10-12 08:00:00'),
          (63, 'BobExecutionAdmission', '2026-10-18 08:00:00')`;

        yield* runMigrations();

        yield* assertLedgerMatchesManifest();
        const rows = yield* readLedger;
        assert.deepStrictEqual(
          rows.find((row) => row.name === "BobExecutionAdmission")?.created_at,
          "2026-10-18 08:00:00",
        );
        const indexes = yield* sql<{ readonly name: string }>`
          SELECT name FROM sqlite_master
          WHERE type = 'index' AND name = 'orchestration_v2_projection_turn_items_failed_error_idx'
        `;
        assert.strictEqual(indexes.length, 1);
        const v1Activities = yield* sql<{ readonly name: string }>`
          SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'projection_thread_activities'
        `;
        assert.deepStrictEqual(v1Activities, []);
        assert.deepEqual(yield* sql`PRAGMA quick_check`, [{ quick_check: "ok" }]);
      }),
    ),
  );

  it.effect("upgrades a custom-local profile after upstream claimed 65 and 66", () =>
    withFreshDatabase(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 64 });
        // custom-local released its lane migrations as 65 and 66.
        yield* sql`DROP INDEX IF EXISTS orchestration_v2_projection_turn_items_failed_error_idx`;
        yield* BoundedShellLookups;
        yield* BobExecutionAdmission;
        yield* sql`INSERT INTO effect_sql_migrations (migration_id, name, created_at) VALUES
          (65, 'BoundedShellLookups', '2026-10-19 08:00:00'),
          (66, 'BobExecutionAdmission', '2026-10-18 08:00:00')`;

        const executed = yield* runMigrations();

        assert.deepStrictEqual(executed, [
          [65, "CodexUsageNativeTurnIndex"],
          [66, "RepairClientSettlementTimestamps"],
          [67, "WebhookDedupe"],
          [68, "ShellStopRequestIndex"],
          [69, "ThreadMessageSearch"],
          [70, "PeerLinks"],
          [71, "PeerLinkFence"],
          [72, "WaitingLinkRequestIndex"],
        ]);
        yield* assertLedgerMatchesManifest();
        const rows = yield* readLedger;
        assert.deepStrictEqual(
          rows.find((row) => row.name === "BoundedShellLookups")?.created_at,
          "2026-10-19 08:00:00",
        );
        const indexes = yield* sql<{ readonly name: string }>`
          SELECT name FROM sqlite_master
          WHERE type = 'index' AND name = 'orchestration_v2_provider_turns_codex_native_id_idx'
        `;
        assert.strictEqual(indexes.length, 1);
        assert.deepEqual(yield* sql`PRAGMA quick_check`, [{ quick_check: "ok" }]);
      }),
    ),
  );

  it.effect("upgrades a custom-local profile after upstream claimed 67 and 68", () =>
    withFreshDatabase(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 66 });
        // custom-local released its lane migrations as 67 and 68.
        yield* sql`DROP INDEX IF EXISTS orchestration_v2_projection_turn_items_failed_error_idx`;
        yield* BoundedShellLookups;
        yield* BobExecutionAdmission;
        yield* sql`INSERT INTO effect_sql_migrations (migration_id, name, created_at) VALUES
          (67, 'BoundedShellLookups', '2026-10-20 08:00:00'),
          (68, 'BobExecutionAdmission', '2026-10-20 08:00:00')`;

        const executed = yield* runMigrations();

        assert.deepStrictEqual(executed, [
          [67, "WebhookDedupe"],
          [68, "ShellStopRequestIndex"],
          [69, "ThreadMessageSearch"],
          [70, "PeerLinks"],
          [71, "PeerLinkFence"],
          [72, "WaitingLinkRequestIndex"],
        ]);
        yield* assertLedgerMatchesManifest();
        const columns = yield* sql<{ readonly name: string }>`
          SELECT name FROM pragma_table_info('peer_environment_links') WHERE name = 'fenced'
        `;
        assert.strictEqual(columns.length, 1);
        assert.deepStrictEqual(yield* runMigrations(), []);
        assert.deepEqual(yield* sql`PRAGMA quick_check`, [{ quick_check: "ok" }]);
      }),
    ),
  );

  it.effect("upgrades a custom-local profile after upstream claimed 68", () =>
    withFreshDatabase(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 67 });
        // custom-local released its lane migrations as 68 through 72.
        yield* PeerLinks;
        yield* PeerLinkFence;
        yield* WaitingLinkRequestIndex;
        yield* sql`DROP INDEX IF EXISTS orchestration_v2_projection_turn_items_failed_error_idx`;
        yield* BoundedShellLookups;
        yield* BobExecutionAdmission;
        yield* sql`INSERT INTO effect_sql_migrations (migration_id, name, created_at) VALUES
          (68, 'PeerLinks', '2026-10-21 08:00:00'),
          (69, 'PeerLinkFence', '2026-10-21 08:00:00'),
          (70, 'WaitingLinkRequestIndex', '2026-10-21 08:00:00'),
          (71, 'BoundedShellLookups', '2026-10-21 08:00:00'),
          (72, 'BobExecutionAdmission', '2026-10-21 08:00:00')`;

        const executed = yield* runMigrations();

        assert.deepStrictEqual(executed, [
          [68, "ShellStopRequestIndex"],
          [69, "ThreadMessageSearch"],
        ]);
        yield* assertLedgerMatchesManifest();
        const rows = yield* readLedger;
        assert.deepStrictEqual(
          rows.find((row) => row.name === "PeerLinks")?.created_at,
          "2026-10-21 08:00:00",
        );
        const indexes = yield* sql<{ readonly name: string }>`
          SELECT name FROM sqlite_master
          WHERE type = 'index' AND name = 'orchestration_v2_projection_turn_items_stop_request_idx'
        `;
        assert.strictEqual(indexes.length, 1);
        assert.deepStrictEqual(yield* runMigrations(), []);
        assert.deepEqual(yield* sql`PRAGMA quick_check`, [{ quick_check: "ok" }]);
      }),
    ),
  );

  it.effect("upgrades a custom-local profile after upstream claimed 69", () =>
    withFreshDatabase(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 68 });
        // custom-local released its lane migrations as 69 through 73.
        yield* PeerLinks;
        yield* PeerLinkFence;
        yield* WaitingLinkRequestIndex;
        yield* sql`DROP INDEX IF EXISTS orchestration_v2_projection_turn_items_failed_error_idx`;
        yield* BoundedShellLookups;
        yield* BobExecutionAdmission;
        yield* sql`INSERT INTO effect_sql_migrations (migration_id, name, created_at) VALUES
          (69, 'PeerLinks', '2026-10-24 08:00:00'),
          (70, 'PeerLinkFence', '2026-10-24 08:00:00'),
          (71, 'WaitingLinkRequestIndex', '2026-10-24 08:00:00'),
          (72, 'BoundedShellLookups', '2026-10-24 08:00:00'),
          (73, 'BobExecutionAdmission', '2026-10-24 08:00:00')`;

        const executed = yield* runMigrations();

        assert.deepStrictEqual(executed, [[69, "ThreadMessageSearch"]]);
        yield* assertLedgerMatchesManifest();
        const triggers = yield* sql<{ readonly name: string }>`
          SELECT name FROM sqlite_master
          WHERE type = 'trigger' AND name = 'orchestration_v2_message_search_insert'
        `;
        assert.strictEqual(triggers.length, 1);
        assert.deepStrictEqual(yield* runMigrations(), []);
        assert.deepEqual(yield* sql`PRAGMA quick_check`, [{ quick_check: "ok" }]);
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

  it.effect("re-runs the index migrations early lane rows held at 19, 29 and 30", () =>
    withFreshDatabase(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations();

        // The GMACKO install's ledger: a lane migration at 19 and another
        // recorded twice at 29/30, so upstream's index migrations there never
        // ran by name. 29's and 30's indexes exist anyway; 19's are missing.
        yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id IN (19, 29, 30)`;
        yield* sql`INSERT INTO effect_sql_migrations (migration_id, name, created_at) VALUES
          (19, 'ProjectionThreadsWorktreeMetadata', '2026-03-29 00:00:00'),
          (29, 'CanonicalizeModelSelectionProviderInstanceIds', '2026-05-02 00:00:00'),
          (30, 'CanonicalizeModelSelectionProviderInstanceIds', '2026-05-08 00:00:00')`;
        yield* sql`DROP INDEX idx_projection_projects_workspace_root_deleted_at`;
        yield* sql`DROP INDEX idx_projection_threads_project_deleted_created`;

        const executed = yield* runMigrations();

        // 29 indexes V1 tables that DropUnusedV1Projections (63) already dropped, so it is
        // recorded without running.
        assert.deepStrictEqual(executed, [
          [19, "ProjectionSnapshotLookupIndexes"],
          [30, "ProjectionThreadShellArchiveIndexes"],
        ]);
        yield* assertLedgerMatchesManifest();
        const indexes = yield* sql<{ readonly name: string }>`
          SELECT name FROM sqlite_master WHERE type = 'index'
        `;
        const names = indexes.map((index) => index.name);
        assert.include(names, "idx_projection_projects_workspace_root_deleted_at");
        assert.include(names, "idx_projection_threads_project_deleted_created");
        assert.include(names, "idx_projection_threads_shell_active");
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

const v2Migrations = migrationManifest.filter(([id]) => id >= 55);
const newerMigrationId = Math.max(...migrationManifest.map(([id]) => id)) + 1;

const history = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly migration_id: number; readonly name: string }>`
    SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
  `;
  return rows.map((row) => [row.migration_id, row.name] as const);
});

const v2TableCount = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'orchestration_v2_%'
  `;
  return rows.length;
});

describe("runMigrations", () => {
  it.effect("refuses to start when another migration took a V2 id", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 54 });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name) VALUES (55, 'FutureMainMigration')
      `;
      const before = yield* history;

      assert.deepStrictEqual(yield* runMigrations({ toMigrationInclusive: 54 }), []);
      const exit = yield* Effect.exit(runMigrations());

      assert.isTrue(Exit.isFailure(exit));
      assert.include(String(exit), "55_OrchestrationV2 (recorded: FutureMainMigration)");
      assert.deepStrictEqual(yield* history, before);
      assert.strictEqual(yield* v2TableCount, 0);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("refuses to start when a later id would skip V2 migrations", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 54 });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (${newerMigrationId}, 'FutureMainMigration')
      `;
      const before = yield* history;

      const exit = yield* Effect.exit(runMigrations());

      assert.isTrue(Exit.isFailure(exit));
      for (const [id, name] of v2Migrations) {
        assert.include(String(exit), `${id}_${name} (recorded: nothing)`);
      }
      assert.deepStrictEqual(yield* history, before);
      assert.strictEqual(yield* v2TableCount, 0);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("upgrades a database at exactly 54", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 54 });
      assert.deepStrictEqual(yield* runMigrations(), v2Migrations);
      assert.deepStrictEqual(yield* history, migrationManifest);
      assert.isAbove(yield* v2TableCount, 0);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect.each([30, 54])("still starts with a site-local migration at id %s", (id) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 54 });
      yield* sql`
        UPDATE effect_sql_migrations SET name = 'SiteLocalMigration' WHERE migration_id = ${id}
      `;

      assert.deepStrictEqual(yield* runMigrations(), v2Migrations);
      assert.isAbove(yield* v2TableCount, 0);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("only checks V2 migrations within the requested limit", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 55 });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (56, 'SiteLocalMigration'), (${newerMigrationId}, 'NewerV2Migration')
      `;
      const before = yield* history;

      assert.deepStrictEqual(yield* runMigrations({ toMigrationInclusive: 55 }), []);
      const exit = yield* Effect.exit(runMigrations({ toMigrationInclusive: 56 }));
      assert.isTrue(Exit.isFailure(exit));
      assert.include(
        String(exit),
        "56_RemoveRedundantProjectionIndexes (recorded: SiteLocalMigration)",
      );
      assert.notInclude(String(exit), "57_ScheduledTaskWebhooks");
      assert.deepStrictEqual(yield* history, before);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );

  it.effect("still starts after a newer build recorded a later V2 migration", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations();
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (${newerMigrationId}, 'NewerV2Migration')
      `;

      assert.deepStrictEqual(yield* runMigrations(), []);
    }).pipe(Effect.provide(NodeSqliteClient.layer({ filename: ":memory:" }))),
  );
});

// The npm launcher reads the highest migration id from these file names.
it.effect("registers every migration file", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = path.join(import.meta.dirname, "Migrations");
    const files = (yield* fs.readDirectory(dir)).flatMap((name) => {
      const match = /^(\d+)_(\w+)\.ts$/.exec(name);
      return match ? [[Number(match[1]), match[2]] as const] : [];
    });
    assert.deepStrictEqual(
      files.toSorted(([a], [b]) => a - b),
      migrationManifest,
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);
