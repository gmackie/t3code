import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_external_thread_imports (
      thread_id TEXT PRIMARY KEY,
      provider_instance_id TEXT NOT NULL,
      provider_driver TEXT NOT NULL,
      continuation_group TEXT NOT NULL,
      native_thread_id TEXT NOT NULL,
      original_cwd TEXT NOT NULL,
      resume_cursor_json TEXT,
      decoder_version TEXT NOT NULL,
      imported_at TEXT NOT NULL,
      event_sequence INTEGER NOT NULL
    )
  `;
  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_external_thread_import_identity
    ON projection_external_thread_imports (
      continuation_group,
      provider_instance_id,
      provider_driver,
      native_thread_id
    )
  `;
});
