import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Provisioning for the orchestration V2 event log ahead of the runtime port.
//
// This intentionally lives at id 99: released profiles carry ledgers up to
// id 44 recorded under several different historical names (the migrator only
// compares ids, never names), so anything slotted into the low 40s is skipped
// forever on those databases. Ids above every observed ledger run everywhere.
//
// Fully guarded: some profiles already contain these objects from earlier
// v2-lineage builds. Remove this file and its registry entry once upstream
// lands its own orchestration v2 schema; stale tracking rows are harmless.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS orchestration_v2_events (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      command_id TEXT,
      thread_id TEXT NOT NULL,
      run_id TEXT,
      node_id TEXT,
      provider TEXT,
      raw_event_id TEXT,
      event_type TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      payload_json TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS orchestration_v2_events_command_idx
    ON orchestration_v2_events(command_id, sequence)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS orchestration_v2_events_thread_sequence_idx
    ON orchestration_v2_events(thread_id, sequence)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS orchestration_v2_events_thread_type_sequence_idx
    ON orchestration_v2_events(thread_id, event_type, sequence)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS orchestration_v2_events_run_sequence_idx
    ON orchestration_v2_events(run_id, sequence)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS orchestration_v2_events_node_sequence_idx
    ON orchestration_v2_events(node_id, sequence)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS orchestration_v2_events_raw_event_idx
    ON orchestration_v2_events(raw_event_id)
  `;
});
