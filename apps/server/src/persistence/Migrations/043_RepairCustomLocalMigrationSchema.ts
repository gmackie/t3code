import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Profiles whose ledgers were recorded before upstream's
  // 036_ProjectionThreadsPinned can never run it again (id <= max), yet
  // current code reads pinned_at unconditionally. Guarded add is a no-op
  // where 036 already applied.
  const pinnedColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  if (!pinnedColumns.some((column) => column.name === "pinned_at")) {
    yield* sql`
      ALTER TABLE projection_threads ADD COLUMN pinned_at TEXT
    `;
  }

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
});
