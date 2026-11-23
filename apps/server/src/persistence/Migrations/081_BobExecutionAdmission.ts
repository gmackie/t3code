import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE bob_execution_admissions (
    request_id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL UNIQUE,
    owner TEXT NOT NULL,
    request_json TEXT NOT NULL,
    launch_json TEXT NOT NULL,
    admission_json TEXT NOT NULL,
    run_id TEXT,
    launched INTEGER NOT NULL DEFAULT 0
  )`;
  yield* sql`CREATE TABLE bob_execution_receipts (request_id TEXT PRIMARY KEY REFERENCES bob_execution_admissions(request_id), payload_json TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0)`;
});
