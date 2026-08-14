// @effect-diagnostics nodeBuiltinImport:off
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import { applyActivityRetention, inspectActivityRetention } from "./stateMaintenance.ts";

const makeFixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), "t3-activity-retention-"));
  const databasePath = join(directory, "state.sqlite");
  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE projection_thread_activities (
      activity_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      tone TEXT NOT NULL,
      kind TEXT NOT NULL,
      summary TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      sequence INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE TABLE projection_pending_approvals (
      request_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      status TEXT NOT NULL
    );
  `);

  const insertActivity = database.prepare(`
    INSERT INTO projection_thread_activities (
      activity_id, thread_id, turn_id, tone, kind, summary, payload_json, sequence, created_at
    ) VALUES (?, 'thread-1', NULL, 'neutral', ?, '', ?, ?, ?)
  `);
  const rows = [
    ["ordinary-old", "assistant.note", "{}", 1, "2026-01-01T00:00:01Z"],
    ["approval-old", "approval.requested", '{"requestId":"approval-1"}', 2, "2026-01-01T00:00:02Z"],
    ["input-old", "user-input.requested", '{"requestId":"input-1"}', 3, "2026-01-01T00:00:03Z"],
    ["resolved-old", "user-input.requested", '{"requestId":"input-2"}', 4, "2026-01-01T00:00:04Z"],
    ["resolved-newer", "user-input.resolved", '{"requestId":"input-2"}', 5, "2026-01-01T00:00:05Z"],
    ["stale-input", "user-input.requested", '{"requestId":"input-3"}', 6, "2026-01-01T00:00:06Z"],
    [
      "stale-failure",
      "provider.user-input.respond.failed",
      '{"requestId":"input-3","detail":"Unknown pending Codex user input request"}',
      7,
      "2026-01-01T00:00:07Z",
    ],
    ["recent-1", "assistant.note", "{}", 8, "2026-01-01T00:00:08Z"],
    ["recent-2", "assistant.note", "{}", 9, "2026-01-01T00:00:09Z"],
  ] as const;
  for (const row of rows) insertActivity.run(...row);
  database
    .prepare(
      "INSERT INTO projection_pending_approvals (request_id, thread_id, status) VALUES (?, ?, ?)",
    )
    .run("approval-1", "thread-1", "pending");
  database.close();
  return { directory, databasePath };
};

const listActivityIds = (databasePath: string) => {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  const rows = database
    .prepare("SELECT activity_id FROM projection_thread_activities ORDER BY sequence")
    .all() as Array<{ activity_id: string }>;
  database.close();
  return rows.map((row) => row.activity_id);
};

describe("activity projection retention", () => {
  it("defaults to a read-only inspection and preserves actionable blocking requests", async () => {
    const { databasePath } = await makeFixture();

    const result = inspectActivityRetention({ databasePath, retainPerThread: 2 });

    expect(result).toMatchObject({ totalActivities: 9, candidateActivities: 5 });
    expect(listActivityIds(databasePath)).toHaveLength(9);
  });

  it("backs up the whole database before deleting candidates", async () => {
    const { directory, databasePath } = await makeFixture();
    const backupPath = join(directory, "backups", "before-retention.sqlite");

    const result = await applyActivityRetention({
      databasePath,
      backupPath,
      retainPerThread: 2,
    });

    expect(result).toMatchObject({ deletedActivities: 5, backupPath });
    expect((await stat(backupPath)).size).toBeGreaterThan(0);
    expect(listActivityIds(backupPath)).toHaveLength(9);
    expect(listActivityIds(databasePath)).toEqual([
      "approval-old",
      "input-old",
      "recent-1",
      "recent-2",
    ]);
  });

  it("refuses to mutate a database owned by a running server", async () => {
    const { directory, databasePath } = await makeFixture();
    const runtimeStatePath = join(directory, "server-runtime.json");
    await writeFile(
      runtimeStatePath,
      JSON.stringify({ version: 1, pid: process.pid, port: 0, origin: "", startedAt: "" }),
    );

    await expect(
      applyActivityRetention({ databasePath, retainPerThread: 2, runtimeStatePath }),
    ).rejects.toThrow(/running server/i);
    expect(JSON.parse(await readFile(runtimeStatePath, "utf8"))).toMatchObject({
      pid: process.pid,
    });
    expect(listActivityIds(databasePath)).toHaveLength(9);
  });
});
