import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const threadColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  if (!threadColumns.some((column) => column.name === "pin_order_key")) {
    yield* sql`ALTER TABLE projection_threads ADD COLUMN pin_order_key TEXT`;
  }

  const projectColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_projects)
  `;
  if (!projectColumns.some((column) => column.name === "default_thread_env_mode")) {
    yield* sql`
      ALTER TABLE projection_projects
      ADD COLUMN default_thread_env_mode TEXT
    `;
  }

  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_external_thread_imports)
  `;

  if (!columns.some((column) => column.name === "environment_id")) {
    yield* sql`
      ALTER TABLE projection_external_thread_imports
      ADD COLUMN environment_id TEXT NOT NULL DEFAULT 'local'
    `;
  }

  yield* sql`DROP INDEX IF EXISTS uq_external_thread_import_identity`;
  yield* sql`
    CREATE UNIQUE INDEX uq_external_thread_import_identity
    ON projection_external_thread_imports (
      environment_id,
      continuation_group,
      provider_instance_id,
      provider_driver,
      native_thread_id
    )
  `;
});
