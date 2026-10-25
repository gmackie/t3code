import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/**
 * Systems Workbench runs (RFC-001 PR 6). Runs belong to the environment, not a thread, so their
 * trace and samples live here rather than in orchestration events. Re-runnable: the ledger
 * reconciler may backfill this by name.
 */
export default Effect.gen(function* () {
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
});
