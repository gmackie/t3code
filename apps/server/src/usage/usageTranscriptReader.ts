// @effect-diagnostics nodeBuiltinImport:off
/**
 * Raw filesystem access for transcript scanning.
 *
 * Isolated here so the rest of the usage code stays on Effect's `FileSystem`.
 * The direct `node:fs` streaming is deliberate: a cold 30-day window is ~1.4 GB
 * across ~1,500 files, and `readline` over a read stream is roughly an order of
 * magnitude cheaper than materialising each file. The equivalent Effect stream
 * pipeline is idiomatic but not fast enough to sit behind a page load.
 *
 * @module usageTranscriptReader
 */
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";

import type { UsageProviderKind } from "@t3tools/contracts";

import {
  initialCodexScanState,
  mightCarryUsage,
  parseClaudeLine,
  parseCodexLine,
  parseGrokLine,
  type UsageRecord,
} from "./usageTranscripts.ts";

export interface TranscriptFile {
  readonly path: string;
  readonly size: number;
  readonly mtimeMs: number;
}

/**
 * Lists `.jsonl` transcripts under `root` last modified at or after `sinceMs`.
 *
 * `fileName` narrows the walk to one exact basename before any stat happens.
 * Grok session directories hold several sibling `.jsonl` streams
 * (chat_history, events, rewind_points) that can never carry usage; skipping
 * them here roughly halves the bytes and stats of a cold Grok scan.
 *
 * Errors on individual entries are swallowed: session files rotate and get
 * removed while the walk is in flight, and a partial listing is far better than
 * failing the page.
 */
export async function listTranscriptFiles(
  root: string,
  sinceMs: number,
  options?: { readonly fileName?: string },
): Promise<readonly TranscriptFile[]> {
  const found: TranscriptFile[] = [];
  const fileName = options?.fileName;

  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await NodeFSP.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = NodePath.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(child);
        continue;
      }
      if (fileName === undefined ? !entry.name.endsWith(".jsonl") : entry.name !== fileName) {
        continue;
      }
      try {
        const stats = await NodeFSP.stat(child);
        if (stats.mtimeMs >= sinceMs) {
          found.push({ path: child, size: stats.size, mtimeMs: stats.mtimeMs });
        }
      } catch {
        // Vanished between readdir and stat.
      }
    }
  };

  await walk(root);
  return found;
}

/**
 * Filesystem identity of a directory, as `device:inode`.
 *
 * Used to tell "two servers reading the same transcript directory" apart from
 * "two machines whose hostname and home path happen to match". Returns an empty
 * string when the directory cannot be stat'd.
 */
export async function readDirectoryVolumeId(path: string): Promise<string> {
  try {
    const stats = await NodeFSP.stat(path);
    return `${stats.dev}:${stats.ino}`;
  } catch {
    return "";
  }
}

/**
 * Whether a Grok transcript belongs to a spawned subagent session.
 *
 * A parent turn's `turn_completed` usage already includes the model calls its
 * subagents made (per-call input arithmetic on real sessions only reconciles
 * with the child calls folded in), yet each subagent also writes its own
 * session directory with its own `turn_completed`. Counting both would double
 * count, so subagent transcripts are skipped in favour of the parent's total.
 * The marker lives in the sibling `summary.json` (`session_kind: "subagent"`,
 * or `"subagent_resume"` for resumed ones); sessions from CLI versions
 * predating the field scan normally.
 */
async function isGrokSubagentTranscript(filePath: string): Promise<boolean> {
  try {
    const raw = await NodeFSP.readFile(
      NodePath.join(NodePath.dirname(filePath), "summary.json"),
      "utf8",
    );
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return false;
    const kind = (parsed as Record<string, unknown>)["session_kind"];
    return typeof kind === "string" && kind.startsWith("subagent");
  } catch {
    return false;
  }
}

const GROK_USAGE_MARKER = Buffer.from('"turn_completed"');
const GROK_SCAN_CHUNK_BYTES = 4 * 1024 * 1024;
const NEWLINE = 0x0a;

/**
 * Scans a Grok `updates.jsonl` by marker search instead of line iteration.
 *
 * These files are dominated by tool-call spam — millions of short lines with
 * at most a few dozen `turn_completed` lines among them — and per-line
 * iteration was the cold scan's bottleneck (~76 MB/s). `Buffer.indexOf` over
 * large chunks runs at raw read speed; only the rare line containing the
 * marker is materialised and JSON-parsed.
 *
 * A carry buffer holds the bytes after each chunk's last newline so a line
 * spanning a chunk boundary is seen whole; memory stays bounded by the
 * longest single line.
 */
async function readGrokTranscriptRecords(filePath: string): Promise<UsageRecord[] | null> {
  const records: UsageRecord[] = [];
  let handle;
  try {
    handle = await NodeFSP.open(filePath, "r");
  } catch {
    return null;
  }
  try {
    const chunk = Buffer.allocUnsafe(GROK_SCAN_CHUNK_BYTES);
    let carry = Buffer.alloc(0);
    for (;;) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (bytesRead === 0) break;
      const window =
        carry.length === 0
          ? chunk.subarray(0, bytesRead)
          : Buffer.concat([carry, chunk.subarray(0, bytesRead)]);
      const lastNewline = window.lastIndexOf(NEWLINE);
      // No newline yet: the current line is still growing; keep accumulating.
      // `subarray` would alias `chunk`, which the next read overwrites.
      if (lastNewline === -1) {
        carry = Buffer.from(window);
        continue;
      }
      const complete = window.subarray(0, lastNewline + 1);
      carry = Buffer.from(window.subarray(lastNewline + 1));

      let searchFrom = 0;
      for (;;) {
        const hit = complete.indexOf(GROK_USAGE_MARKER, searchFrom);
        if (hit === -1) break;
        const lineStart = complete.lastIndexOf(NEWLINE, hit) + 1;
        const lineEnd = complete.indexOf(NEWLINE, hit);
        records.push(...parseGrokLine(complete.subarray(lineStart, lineEnd).toString("utf8")));
        searchFrom = lineEnd + 1;
      }
    }
    // A final line without a trailing newline can still carry the last turn.
    if (carry.includes(GROK_USAGE_MARKER)) {
      records.push(...parseGrokLine(carry.toString("utf8")));
    }
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => {});
  }
  return records;
}

/**
 * Streams one transcript and returns the usage records it contains, or `null`
 * when the file could not be read.
 *
 * The distinction matters to the caller's cache: a genuinely empty transcript
 * is a stable fact worth memoising, while a transient read failure memoised
 * under the same `(size, mtime)` key would silently drop that file's usage
 * until the file next changes.
 *
 * Codex carries the active model on `turn_context` lines that hold no usage of
 * their own, so those still have to pass through the reducer to keep model
 * attribution correct.
 */
export async function readTranscriptRecords(
  filePath: string,
  provider: UsageProviderKind,
): Promise<readonly UsageRecord[] | null> {
  if (provider === "grok") {
    // A subagent's usage is already inside its parent's turn totals; an empty
    // result here is a stable fact of the session, so it is safe to memoise.
    if (await isGrokSubagentTranscript(filePath)) return [];
    return await readGrokTranscriptRecords(filePath);
  }

  const records: UsageRecord[] = [];
  const codexState = initialCodexScanState();

  try {
    const lines = NodeReadline.createInterface({
      input: NodeFS.createReadStream(filePath, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });

    for await (const line of lines) {
      if (provider === "codex") {
        if (
          !mightCarryUsage(line, provider) &&
          !line.includes('"turn_context"') &&
          !line.includes('"session_meta"')
        ) {
          continue;
        }
        const record = parseCodexLine(line, codexState);
        if (record !== null) records.push(record);
        continue;
      }

      if (!mightCarryUsage(line, provider)) continue;
      if (provider === "grok") {
        records.push(...parseGrokLine(line));
        continue;
      }
      const record = parseClaudeLine(line);
      if (record !== null) records.push(record);
    }
  } catch {
    return null;
  }

  return records;
}
