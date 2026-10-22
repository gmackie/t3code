import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import type * as SqlError from "effect/sql/SqlError";

import { toPersistenceSqlError } from "../persistence/Errors.ts";

/**
 * Engine tables live outside the shared migration ledger: that ledger re-keys
 * by name and backfills ids, and fork-only schema belongs in its own table
 * (docs/internals/legacy-orchestration-migration.md). Append new entries; never
 * renumber or edit an applied one. Each statement must be safe to re-run.
 */
const engineMigrations: ReadonlyArray<
  readonly [
    id: number,
    name: string,
    run: Effect.Effect<unknown, SqlError.SqlError, SqlClient.SqlClient>,
  ]
> = [
  [
    1,
    "Journal",
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`CREATE TABLE IF NOT EXISTS engine_events (
        tenant_id TEXT NOT NULL,
        stream_id TEXT NOT NULL,
        stream_version INTEGER NOT NULL,
        event_id TEXT NOT NULL UNIQUE,
        event_type TEXT NOT NULL,
        run_id TEXT,
        actor_json TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        PRIMARY KEY (tenant_id, stream_id, stream_version)
      )`;
      yield* sql`CREATE TABLE IF NOT EXISTS engine_command_receipts (
        tenant_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        command_type TEXT NOT NULL,
        stream_id TEXT NOT NULL,
        result_version INTEGER NOT NULL,
        accepted_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, idempotency_key)
      )`;
    }),
  ],
];

export const runEngineMigrations = Effect.fn("runEngineMigrations")(
  function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE TABLE IF NOT EXISTS engine_schema_migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    applied_at TEXT NOT NULL
  )`;
    const applied = yield* sql<{ readonly id: number; readonly name: string }>`
    SELECT id, name FROM engine_schema_migrations
  `;
    const appliedById = new Map(applied.map((row) => [row.id, row.name]));
    for (const [id, name, run] of engineMigrations) {
      const appliedName = appliedById.get(id);
      if (appliedName === name) continue;
      if (appliedName !== undefined) {
        return yield* Effect.die(
          new Error(`Engine migration ${id} is recorded as ${appliedName}, expected ${name}.`),
        );
      }
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* run;
          const appliedAt = DateTime.formatIso(yield* DateTime.now);
          yield* sql`
          INSERT INTO engine_schema_migrations (id, name, applied_at)
          VALUES (${id}, ${name}, ${appliedAt})
        `;
        }),
      );
    }
  },
  Effect.mapError(toPersistenceSqlError("runEngineMigrations")),
);
