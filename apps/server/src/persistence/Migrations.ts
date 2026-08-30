/**
 * Migration runner with an inline loader.
 *
 * Uses Migrator.make with fromRecord to define migrations inline.
 * All migrations are statically imported - no dynamic file system loading.
 *
 * `runMigrations` is called by the SQLite persistence layer at startup, so the
 * schema is always up to date before the application starts.
 */

import * as Migrator from "effect/unstable/sql/Migrator";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Import all migrations statically
import Migration0001 from "./Migrations/001_OrchestrationEvents.ts";
import Migration0002 from "./Migrations/002_OrchestrationCommandReceipts.ts";
import Migration0003 from "./Migrations/003_CheckpointDiffBlobs.ts";
import Migration0004 from "./Migrations/004_ProviderSessionRuntime.ts";
import Migration0005 from "./Migrations/005_Projections.ts";
import Migration0006 from "./Migrations/006_ProjectionThreadSessionRuntimeModeColumns.ts";
import Migration0007 from "./Migrations/007_ProjectionThreadMessageAttachments.ts";
import Migration0008 from "./Migrations/008_ProjectionThreadActivitySequence.ts";
import Migration0009 from "./Migrations/009_ProviderSessionRuntimeMode.ts";
import Migration0010 from "./Migrations/010_ProjectionThreadsRuntimeMode.ts";
import Migration0011 from "./Migrations/011_OrchestrationThreadCreatedRuntimeMode.ts";
import Migration0012 from "./Migrations/012_ProjectionThreadsInteractionMode.ts";
import Migration0013 from "./Migrations/013_ProjectionThreadProposedPlans.ts";
import Migration0014 from "./Migrations/014_ProjectionThreadProposedPlanImplementation.ts";
import Migration0015 from "./Migrations/015_ProjectionTurnsSourceProposedPlan.ts";
import Migration0016 from "./Migrations/016_CanonicalizeModelSelections.ts";
import Migration0017 from "./Migrations/017_ProjectionThreadsArchivedAt.ts";
import Migration0018 from "./Migrations/018_ProjectionThreadsArchivedAtIndex.ts";
import Migration0019 from "./Migrations/019_ProjectionSnapshotLookupIndexes.ts";
import Migration0020 from "./Migrations/020_AuthAccessManagement.ts";
import Migration0021 from "./Migrations/021_AuthSessionClientMetadata.ts";
import Migration0022 from "./Migrations/022_AuthSessionLastConnectedAt.ts";
import Migration0023 from "./Migrations/023_ProjectionThreadShellSummary.ts";
import Migration0024 from "./Migrations/024_BackfillProjectionThreadShellSummary.ts";
import Migration0025 from "./Migrations/025_CleanupInvalidProjectionPendingApprovals.ts";
import Migration0026 from "./Migrations/026_CanonicalizeModelSelectionOptions.ts";
import Migration0027 from "./Migrations/027_ProviderSessionRuntimeInstanceId.ts";
import Migration0028 from "./Migrations/028_ProjectionThreadSessionInstanceId.ts";
import Migration0029 from "./Migrations/029_ProjectionThreadDetailOrderingIndexes.ts";
import Migration0030 from "./Migrations/030_ProjectionThreadShellArchiveIndexes.ts";
import Migration0031 from "./Migrations/031_AuthAuthorizationScopes.ts";
import Migration0032 from "./Migrations/032_AuthPairingProofKeyThumbprint.ts";
import Migration0033 from "./Migrations/033_ProjectionThreadsSettled.ts";
import Migration0034 from "./Migrations/034_ProjectionThreadsSnoozed.ts";
import Migration0035 from "./Migrations/035_ProjectionThreadTitleRegeneration.ts";
import Migration0036 from "./Migrations/036_ProjectionThreadsPinned.ts";
import Migration0037 from "./Migrations/037_ProjectionTurnsKeysetIndex.ts";
import Migration0038 from "./Migrations/038_ProjectionThreadsPinOrderKey.ts";
import Migration0039 from "./Migrations/039_ProjectionProjectsDefaultThreadEnvMode.ts";
import Migration0040 from "./Migrations/040_ProjectionProjectFaviconPath.ts";
import Migration0041 from "./Migrations/041_AuthSessionClientConnection.ts";
import Migration0042 from "./Migrations/042_ProjectionThreadLinkedPullRequest.ts";
import Migration0043 from "./Migrations/043_ProjectionThreadsUnsettledAt.ts";
import Migration0044 from "./Migrations/044_ExternalThreadImports.ts";
import Migration0045 from "./Migrations/045_ExternalThreadImportEnvironments.ts";

/**
 * Migration loader with all migrations defined inline.
 *
 * Key format: "{id}_{name}" where:
 * - id: numeric migration ID (determines execution order)
 * - name: descriptive name for the migration
 *
 * Uses Migrator.fromRecord which parses the key format and
 * returns migrations sorted by ID.
 */
export const migrationEntries = [
  [1, "OrchestrationEvents", Migration0001],
  [2, "OrchestrationCommandReceipts", Migration0002],
  [3, "CheckpointDiffBlobs", Migration0003],
  [4, "ProviderSessionRuntime", Migration0004],
  [5, "Projections", Migration0005],
  [6, "ProjectionThreadSessionRuntimeModeColumns", Migration0006],
  [7, "ProjectionThreadMessageAttachments", Migration0007],
  [8, "ProjectionThreadActivitySequence", Migration0008],
  [9, "ProviderSessionRuntimeMode", Migration0009],
  [10, "ProjectionThreadsRuntimeMode", Migration0010],
  [11, "OrchestrationThreadCreatedRuntimeMode", Migration0011],
  [12, "ProjectionThreadsInteractionMode", Migration0012],
  [13, "ProjectionThreadProposedPlans", Migration0013],
  [14, "ProjectionThreadProposedPlanImplementation", Migration0014],
  [15, "ProjectionTurnsSourceProposedPlan", Migration0015],
  [16, "CanonicalizeModelSelections", Migration0016],
  [17, "ProjectionThreadsArchivedAt", Migration0017],
  [18, "ProjectionThreadsArchivedAtIndex", Migration0018],
  [19, "ProjectionSnapshotLookupIndexes", Migration0019],
  [20, "AuthAccessManagement", Migration0020],
  [21, "AuthSessionClientMetadata", Migration0021],
  [22, "AuthSessionLastConnectedAt", Migration0022],
  [23, "ProjectionThreadShellSummary", Migration0023],
  [24, "BackfillProjectionThreadShellSummary", Migration0024],
  [25, "CleanupInvalidProjectionPendingApprovals", Migration0025],
  [26, "CanonicalizeModelSelectionOptions", Migration0026],
  [27, "ProviderSessionRuntimeInstanceId", Migration0027],
  [28, "ProjectionThreadSessionInstanceId", Migration0028],
  [29, "ProjectionThreadDetailOrderingIndexes", Migration0029],
  [30, "ProjectionThreadShellArchiveIndexes", Migration0030],
  [31, "AuthAuthorizationScopes", Migration0031],
  [32, "AuthPairingProofKeyThumbprint", Migration0032],
  [33, "ProjectionThreadsSettled", Migration0033],
  [34, "ProjectionThreadsSnoozed", Migration0034],
  [35, "ProjectionThreadTitleRegeneration", Migration0035],
  [36, "ProjectionThreadsPinned", Migration0036],
  [37, "ProjectionTurnsKeysetIndex", Migration0037],
  [38, "ProjectionThreadsPinOrderKey", Migration0038],
  [39, "ProjectionProjectsDefaultThreadEnvMode", Migration0039],
  [40, "ProjectionProjectFaviconPath", Migration0040],
  [41, "AuthSessionClientConnection", Migration0041],
  [42, "ProjectionThreadLinkedPullRequest", Migration0042],
  [43, "ProjectionThreadsUnsettledAt", Migration0043],
  [44, "ExternalThreadImports", Migration0044],
  [45, "ExternalThreadImportEnvironments", Migration0045],
] as const;

export const migrationManifest = migrationEntries.map(([id, name]) => [id, name] as const);

export const makeMigrationLoader = (throughId?: number) =>
  Migrator.fromRecord(
    Object.fromEntries(
      migrationEntries
        .filter(([id]) => throughId === undefined || id <= throughId)
        .map(([id, name, migration]) => [`${id}_${name}`, migration]),
    ),
  );

/**
 * Migrator run function - no schema dumping needed
 * Uses the base Migrator.make without platform dependencies
 */
const run = Migrator.make({});

/**
 * Historic lane migrations whose effects are baked into existing profiles but
 * which the manifest no longer carries. Their ledger rows are safe to drop;
 * any OTHER unknown name is a foreign migration (another checkout's code) and
 * is left untouched so downstream collision checks stay loud.
 */
const retiredLaneMigrations = new Set([
  "RepairCustomLocalMigrationSchema",
  "RepairCustomLocalProjectionIndexes",
  "OrchestrationV2Events",
]);

/**
 * Migrations from the renumbering era onward are written re-runnable
 * (guarded column adds, CREATE INDEX IF NOT EXISTS), so the reconciler may
 * backfill them. Older migrations predate every renumbered ledger and must
 * never be re-executed.
 */
const firstRerunnableMigrationId = 33;

/**
 * The GMACKO lane rebases onto upstream, and upstream occasionally claims
 * migration ids the lane was using, so lane migrations get renumbered. The
 * migrator tracks applied migrations by numeric id only and skips every id at
 * or below the highest recorded one, which turns a renumbered ledger into
 * silently skipped migrations and a schema that lags the code (missing
 * columns surface later as runtime SQL errors, not migration failures).
 *
 * Reconcile the ledger by migration NAME before the migrator runs:
 * - rows whose name moved to a new id are re-keyed to the manifest id
 * - rows named in retiredLaneMigrations are dropped (their schema effects
 *   stay in place); rows with any other unknown name are left exactly where
 *   they are
 * - re-runnable manifest migrations below the highest applied id that were
 *   never applied by name ("holes" created by past renumbering) are executed
 *   and recorded
 *
 * Aligned ledgers (every fresh install, and every repaired profile after one
 * boot) short-circuit without writing anything, as does any ledger where a
 * foreign row occupies a slot the reconciliation would need.
 */
export const reconcileMigrationLedger = Effect.fn("reconcileMigrationLedger")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const ledgerTables = yield* sql<{ readonly name: string }>`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
  `;
  if (ledgerTables.length === 0) return;
  const rows = yield* sql<{
    readonly migration_id: number;
    readonly name: string;
    readonly created_at: string;
  }>`SELECT migration_id, name, created_at FROM effect_sql_migrations ORDER BY migration_id`;
  const manifestIdByName = new Map<string, number>(
    migrationEntries.map(([id, name]) => [name, id]),
  );
  const aligned = rows.every((row, index) => {
    const manifestId = manifestIdByName.get(row.name);
    if (manifestId === undefined) return !retiredLaneMigrations.has(row.name);
    return manifestId === row.migration_id && rows.findIndex((o) => o.name === row.name) === index;
  });
  if (aligned) return;

  const foreignRows = rows.filter(
    (row) => !manifestIdByName.has(row.name) && !retiredLaneMigrations.has(row.name),
  );
  const foreignIds = new Set(foreignRows.map((row) => row.migration_id));
  const appliedAtByName = new Map<string, string>();
  for (const row of rows) {
    if (manifestIdByName.has(row.name) && !appliedAtByName.has(row.name)) {
      appliedAtByName.set(row.name, row.created_at);
    }
  }
  const highestAppliedId = migrationEntries.reduce(
    (highest, [id, name]) => (appliedAtByName.has(name) && id > highest ? id : highest),
    0,
  );
  const wantsSlot = (id: number, name: string) =>
    appliedAtByName.has(name) || (id >= firstRerunnableMigrationId && id < highestAppliedId);
  if (migrationEntries.some(([id, name]) => wantsSlot(id, name) && foreignIds.has(id))) {
    yield* Effect.logWarning(
      "Migration ledger has foreign rows on manifest slots; leaving it untouched",
    ).pipe(Effect.annotateLogs({ foreign: foreignRows.map((r) => `${r.migration_id}_${r.name}`) }));
    return;
  }

  const dropped = rows
    .filter((row) => retiredLaneMigrations.has(row.name))
    .map((row) => `${row.migration_id}_${row.name}`);
  const backfilled: Array<string> = [];

  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`DELETE FROM effect_sql_migrations`;
      for (const row of foreignRows) {
        yield* sql`
          INSERT INTO effect_sql_migrations (migration_id, name, created_at)
          VALUES (${row.migration_id}, ${row.name}, ${row.created_at})
        `;
      }
      for (const [id, name, migration] of migrationEntries) {
        const appliedAt = appliedAtByName.get(name);
        if (appliedAt !== undefined) {
          yield* sql`
            INSERT INTO effect_sql_migrations (migration_id, name, created_at)
            VALUES (${id}, ${name}, ${appliedAt})
          `;
        } else if (id >= firstRerunnableMigrationId && id < highestAppliedId) {
          yield* migration;
          backfilled.push(`${id}_${name}`);
          yield* sql`
            INSERT INTO effect_sql_migrations (migration_id, name, created_at)
            VALUES (${id}, ${name}, CURRENT_TIMESTAMP)
          `;
        }
      }
    }),
  );
  yield* Effect.log("Reconciled migration ledger").pipe(
    Effect.annotateLogs({ dropped, backfilled }),
  );
});

export interface RunMigrationsOptions {
  readonly toMigrationInclusive?: number | undefined;
}

/**
 * Run all pending migrations.
 *
 * Creates the migrations tracking table (effect_sql_migrations) if it doesn't exist,
 * then runs any migrations with ID greater than the latest recorded migration.
 *
 * Returns array of [id, name] tuples for migrations that were run.
 *
 * @returns Effect containing array of executed migrations
 */
export const runMigrations = Effect.fn("runMigrations")(function* ({
  toMigrationInclusive,
}: RunMigrationsOptions = {}) {
  yield* reconcileMigrationLedger();
  const executedMigrations = yield* run({ loader: makeMigrationLoader(toMigrationInclusive) });
  const migrations = executedMigrations.map(([id, name]) => `${id}_${name}`);
  yield* migrations.length === 0
    ? Effect.logDebug("Database schema is current")
    : Effect.log("Migrations ran successfully").pipe(Effect.annotateLogs({ migrations }));
  return executedMigrations;
});
