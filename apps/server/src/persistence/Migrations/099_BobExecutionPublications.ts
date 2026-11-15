import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// One publish attempt per admitted request, so receipt retries never push or open a PR twice.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE bob_execution_publications (request_id TEXT PRIMARY KEY REFERENCES bob_execution_admissions(request_id), result_json TEXT NOT NULL)`;
});
