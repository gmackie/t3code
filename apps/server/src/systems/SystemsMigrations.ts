import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import type * as SqlError from "effect/sql/SqlError";

import { toPersistenceSqlError } from "../persistence/Errors.ts";

/**
 * Systems tables live outside the shared migration ledger, like the engine's: that ledger compares
 * ids only, so a fork id there can be masked by a later upstream one
 * (docs/internals/legacy-orchestration-migration.md). Append entries; never renumber or edit an
 * applied one. Each statement must be safe to re-run.
 */
const systemsMigrations: ReadonlyArray<
  readonly [
    id: number,
    name: string,
    run: Effect.Effect<unknown, SqlError.SqlError, SqlClient.SqlClient>,
  ]
> = [
  [
    1,
    "Runs",
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* sql`
        CREATE TABLE IF NOT EXISTS systems_runs (
          run_id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          systems_path TEXT NOT NULL,
          experiment_ref TEXT NOT NULL,
          idempotency_key TEXT NOT NULL,
          cancel_idempotency_key TEXT,
          status TEXT NOT NULL,
          record_json TEXT NOT NULL,
          plan_json TEXT NOT NULL,
          experiment_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          UNIQUE (project_id, idempotency_key)
        )
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS systems_runs_project_created_idx
        ON systems_runs(project_id, created_at DESC)
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS systems_runs_status_idx ON systems_runs(status)
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS systems_run_events (
          run_id TEXT NOT NULL,
          sequence INTEGER NOT NULL,
          event_json TEXT NOT NULL,
          PRIMARY KEY (run_id, sequence)
        ) WITHOUT ROWID
      `;
      yield* sql`
        CREATE TABLE IF NOT EXISTS systems_run_samples (
          run_id TEXT NOT NULL,
          ordinal INTEGER NOT NULL,
          signal_id TEXT NOT NULL,
          seconds REAL NOT NULL,
          time_num TEXT NOT NULL,
          time_den TEXT NOT NULL,
          side TEXT NOT NULL,
          value REAL NOT NULL,
          is_boolean INTEGER NOT NULL,
          unit TEXT NOT NULL,
          PRIMARY KEY (run_id, ordinal)
        ) WITHOUT ROWID
      `;
      yield* sql`
        CREATE INDEX IF NOT EXISTS systems_run_samples_signal_idx
        ON systems_run_samples(run_id, signal_id, seconds, ordinal)
      `;
    }),
  ],
];

export const runSystemsMigrations = Effect.fn("runSystemsMigrations")(
  function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE TABLE IF NOT EXISTS systems_schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    )`;
    const applied = yield* sql<{ readonly id: number; readonly name: string }>`
      SELECT id, name FROM systems_schema_migrations
    `;
    const appliedById = new Map(applied.map((row) => [row.id, row.name]));
    for (const [id, name, run] of systemsMigrations) {
      const appliedName = appliedById.get(id);
      if (appliedName === name) continue;
      if (appliedName !== undefined)
        return yield* Effect.die(
          new Error(`Systems migration ${id} is recorded as ${appliedName}, expected ${name}.`),
        );
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* run;
          const appliedAt = DateTime.formatIso(yield* DateTime.now);
          yield* sql`
            INSERT INTO systems_schema_migrations (id, name, applied_at)
            VALUES (${id}, ${name}, ${appliedAt})
          `;
        }),
      );
    }
  },
  Effect.mapError(toPersistenceSqlError("runSystemsMigrations")),
);
