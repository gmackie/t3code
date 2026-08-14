// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Offline SQLite maintenance is an explicit Node boundary.
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface ActivityRetentionInspection {
  readonly databasePath: string;
  readonly retainPerThread: number;
  readonly totalActivities: number;
  readonly candidateActivities: number;
  readonly databaseBytes: number;
}

export interface ActivityRetentionResult extends ActivityRetentionInspection {
  readonly deletedActivities: number;
  readonly backupPath: string;
  readonly compactedDatabaseBytes: number;
}

interface ActivityRetentionOptions {
  readonly databasePath: string;
  readonly retainPerThread: number;
}

interface ApplyActivityRetentionOptions extends ActivityRetentionOptions {
  readonly backupPath?: string;
  readonly runtimeStatePath?: string;
}

const candidatesSql = `
  WITH ranked_activities AS (
    SELECT
      activity_id,
      ROW_NUMBER() OVER (
        PARTITION BY thread_id
        ORDER BY sequence DESC, created_at DESC, activity_id DESC
      ) AS recent_order
    FROM projection_thread_activities
  ),
  pending_approval_activities AS (
    SELECT activity_id
    FROM (
      SELECT
        activity.activity_id,
        ROW_NUMBER() OVER (
          PARTITION BY pending.request_id
          ORDER BY activity.created_at DESC, activity.activity_id DESC
        ) AS request_order
      FROM projection_pending_approvals AS pending
      INNER JOIN projection_thread_activities AS activity
        ON activity.thread_id = pending.thread_id
       AND activity.kind = 'approval.requested'
       AND json_extract(activity.payload_json, '$.requestId') = pending.request_id
      WHERE pending.status = 'pending'
    )
    WHERE request_order = 1
  ),
  user_input_lifecycle AS (
    SELECT activity_id, kind, request_order
    FROM (
      SELECT
        activity_id,
        kind,
        ROW_NUMBER() OVER (
          PARTITION BY thread_id, json_extract(payload_json, '$.requestId')
          ORDER BY created_at DESC, activity_id DESC
        ) AS request_order
      FROM projection_thread_activities
      WHERE (
        kind IN ('user-input.requested', 'user-input.resolved')
        OR (
          kind = 'provider.user-input.respond.failed'
          AND (
            lower(COALESCE(json_extract(payload_json, '$.detail'), ''))
              LIKE '%stale pending user-input request%'
            OR lower(COALESCE(json_extract(payload_json, '$.detail'), ''))
              LIKE '%unknown pending user-input request%'
            OR lower(COALESCE(json_extract(payload_json, '$.detail'), ''))
              LIKE '%unknown pending user input request%'
            OR lower(COALESCE(json_extract(payload_json, '$.detail'), ''))
              LIKE '%unknown pending codex user input request%'
          )
        )
      )
      AND json_extract(payload_json, '$.requestId') IS NOT NULL
    )
  ),
  pinned_activity_ids AS (
    SELECT activity_id FROM pending_approval_activities
    UNION
    SELECT activity_id
    FROM user_input_lifecycle
    WHERE request_order = 1 AND kind = 'user-input.requested'
  )
  SELECT ranked.activity_id
  FROM ranked_activities AS ranked
  LEFT JOIN pinned_activity_ids AS pinned ON pinned.activity_id = ranked.activity_id
  WHERE ranked.recent_order > ? AND pinned.activity_id IS NULL
`;

const validateRetainPerThread = (retainPerThread: number) => {
  if (!Number.isSafeInteger(retainPerThread) || retainPerThread < 1) {
    throw new Error("retainPerThread must be a positive integer.");
  }
};

const countActivities = (database: DatabaseSync, retainPerThread: number) => {
  const total = database
    .prepare("SELECT COUNT(*) AS count FROM projection_thread_activities")
    .get()?.count;
  const candidates = database
    .prepare(`SELECT COUNT(*) AS count FROM (${candidatesSql})`)
    .get(retainPerThread)?.count;
  return { totalActivities: Number(total), candidateActivities: Number(candidates) };
};

const isProcessAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === "EPERM";
  }
};

const assertServerStopped = (runtimeStatePath: string) => {
  if (!existsSync(runtimeStatePath)) return;
  try {
    const state = JSON.parse(readFileSync(runtimeStatePath, "utf8")) as { readonly pid?: unknown };
    if (typeof state.pid === "number" && isProcessAlive(state.pid)) {
      throw new Error(
        `Refusing activity retention while the running server process ${state.pid} owns this state directory.`,
      );
    }
  } catch (cause) {
    if (cause instanceof SyntaxError) {
      throw new Error(`Refusing activity retention because ${runtimeStatePath} is not valid JSON.`);
    }
    throw cause;
  }
};

const defaultBackupPath = (databasePath: string) => {
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  return join(
    dirname(databasePath),
    "backups",
    `state-before-activity-retention-${timestamp}.sqlite`,
  );
};

export const inspectActivityRetention = ({
  databasePath,
  retainPerThread,
}: ActivityRetentionOptions): ActivityRetentionInspection => {
  validateRetainPerThread(retainPerThread);
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return {
      databasePath,
      retainPerThread,
      ...countActivities(database, retainPerThread),
      databaseBytes: statSync(databasePath).size,
    };
  } finally {
    database.close();
  }
};

export const applyActivityRetention = async ({
  databasePath,
  retainPerThread,
  backupPath = defaultBackupPath(databasePath),
  runtimeStatePath = join(dirname(databasePath), "server-runtime.json"),
}: ApplyActivityRetentionOptions): Promise<ActivityRetentionResult> => {
  validateRetainPerThread(retainPerThread);
  assertServerStopped(runtimeStatePath);
  if (existsSync(backupPath)) throw new Error(`Backup already exists at ${backupPath}.`);
  mkdirSync(dirname(backupPath), { recursive: true });

  const databaseBytes = statSync(databasePath).size;
  const database = new DatabaseSync(databasePath, { timeout: 1_000 });
  try {
    database.exec("PRAGMA locking_mode = EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT;");
    assertServerStopped(runtimeStatePath);
    const inspection = countActivities(database, retainPerThread);

    database.prepare("VACUUM INTO ?").run(backupPath);
    database.exec("BEGIN IMMEDIATE;");
    let deletedActivities: number;
    try {
      const deletion = database
        .prepare(`DELETE FROM projection_thread_activities WHERE activity_id IN (${candidatesSql})`)
        .run(retainPerThread);
      deletedActivities = Number(deletion.changes);
      database.exec("COMMIT;");
    } catch (cause) {
      database.exec("ROLLBACK;");
      throw cause;
    }

    try {
      database.exec("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;");
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new Error(
        `Activity retention deleted ${deletedActivities} rows after writing ${backupPath}, but physical compaction failed: ${detail}`,
        { cause },
      );
    }

    return {
      databasePath,
      retainPerThread,
      ...inspection,
      databaseBytes,
      deletedActivities,
      backupPath,
      compactedDatabaseBytes: statSync(databasePath).size,
    };
  } finally {
    database.close();
  }
};
