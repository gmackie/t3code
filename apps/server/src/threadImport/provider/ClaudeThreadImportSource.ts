// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off -- Claude's private JSONL compatibility boundary needs stable positioned reads and tolerant unknown-record decoding.
import * as NodeFSP from "node:fs/promises";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import type { ClaudeSettings, ProviderInstanceRef } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { resolveClaudeHomePath } from "../../provider/Drivers/ClaudeHome.ts";
import {
  NormalizedThreadImportHistory,
  ThreadImportDiscoveryError,
  ThreadImportLoadError,
  type NormalizedThreadImportHistoryItem,
  type ThreadImportCandidate,
  type ThreadImportCandidateMetadata,
  type ThreadImportSource,
} from "../ThreadImportSource.ts";

export const MAX_CLAUDE_TRANSCRIPT_BYTES = 1 * 1_024 * 1_024 * 1_024;
export const MAX_CLAUDE_TRANSCRIPT_LINE_BYTES = 32 * 1_024 * 1_024;
const MAX_CLAUDE_RETAINED_RECORDS = 50_000;
const TRANSCRIPT_READ_BUFFER_BYTES = 64 * 1_024;
const DISCOVERY_WINDOW_BYTES = 128 * 1_024;
const MAX_CLAUDE_INDEX_BYTES = 2 * 1_024 * 1_024;
const MAX_METADATA_CHARS = 4_096;
const DECODER_VERSION = "claude-code-jsonl-v1";
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const decodeHistory = Schema.decodeUnknownEffect(NormalizedThreadImportHistory);

interface TranscriptLocation {
  readonly sessionId: string;
  readonly path: string;
  readonly size: number;
  readonly mtimeMs: number;
}

interface ClaudeRecord {
  readonly type: string;
  readonly sessionId?: string;
  readonly uuid?: string;
  readonly parentUuid?: string | null;
  readonly cwd?: string;
  readonly timestamp?: string;
  readonly message?: { readonly role?: string; readonly content?: unknown };
  readonly subtype?: string;
  readonly error?: unknown;
  readonly isMeta?: boolean;
  readonly isCompactSummary?: boolean;
  readonly prompt?: unknown;
  readonly response?: unknown;
  readonly decision?: unknown;
}

interface IndexedMetadata {
  readonly recordedCwd: string;
  readonly metadata: ThreadImportCandidateMetadata;
}
type IndexedEntry = Record<string, unknown>;
type IndexedEntryMap = Map<string, IndexedEntry | null>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asRecord = (value: unknown): ClaudeRecord | undefined => {
  if (!isObject(value) || typeof value.type !== "string" || value.type.length === 0)
    return undefined;
  return value as unknown as ClaudeRecord;
};

const parseTime = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) && time >= 0 ? time : undefined;
};

const bounded = (value: string): string => value.slice(0, MAX_METADATA_CHARS);

const isWithin = (parent: string, child: string): boolean => {
  const relative = NodePath.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${NodePath.sep}`) && relative !== "..");
};

async function listTranscriptLocations(
  projectsRoot: string,
): Promise<ReadonlyArray<TranscriptLocation>> {
  let canonicalRoot: string;
  try {
    canonicalRoot = await NodeFSP.realpath(projectsRoot);
  } catch {
    return [];
  }
  const directories = await NodeFSP.readdir(canonicalRoot, { withFileTypes: true });
  const locations: Array<TranscriptLocation> = [];
  for (const directory of directories) {
    if (!directory.isDirectory() || directory.isSymbolicLink()) continue;
    const directoryPath = NodePath.join(canonicalRoot, directory.name);
    const entries = await NodeFSP.readdir(directoryPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(".jsonl")) continue;
      const sessionId = entry.name.slice(0, -".jsonl".length);
      if (!SESSION_ID.test(sessionId)) continue;
      const candidatePath = NodePath.join(directoryPath, entry.name);
      const canonicalPath = await NodeFSP.realpath(candidatePath);
      if (!isWithin(canonicalRoot, canonicalPath)) continue;
      const stat = await NodeFSP.stat(canonicalPath);
      if (!stat.isFile()) continue;
      locations.push({ sessionId, path: canonicalPath, size: stat.size, mtimeMs: stat.mtimeMs });
    }
  }
  return locations;
}

async function readDiscoveryWindows(
  location: TranscriptLocation,
): Promise<ReadonlyArray<ClaudeRecord>> {
  if (location.size <= 0) return [];
  const handle = await NodeFSP.open(
    location.path,
    NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW,
  );
  try {
    const headSize = Math.min(location.size, DISCOVERY_WINDOW_BYTES);
    const head = Buffer.alloc(headSize);
    await handle.read(head, 0, headSize, 0);
    let text = head.toString("utf8");
    if (location.size > headSize) {
      const tailSize = Math.min(location.size - headSize, DISCOVERY_WINDOW_BYTES);
      const tail = Buffer.alloc(tailSize);
      await handle.read(tail, 0, tailSize, location.size - tailSize);
      text += `\n${tail.toString("utf8")}`;
    }
    const records: Array<ClaudeRecord> = [];
    for (const rawLine of text.split(/\r?\n/)) {
      if (!rawLine.startsWith("{")) continue;
      try {
        const record = asRecord(JSON.parse(rawLine));
        if (record) records.push(record);
      } catch {
        // Window boundaries may contain partial JSON. Discovery remains metadata-only and tolerant.
      }
    }
    return records;
  } finally {
    await handle.close();
  }
}

const indexTime = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.trunc(value);
  return typeof value === "string" ? parseTime(value) : undefined;
};

async function readIndexedMetadata(
  location: TranscriptLocation,
  canonicalRoot: string,
  cache: Map<string, IndexedEntryMap | undefined>,
  onIndexRead?: (path: string) => void,
  onIndexEntry?: () => void,
): Promise<IndexedMetadata | undefined> {
  const indexPath = NodePath.join(NodePath.dirname(location.path), "sessions-index.json");
  let entriesBySession = cache.get(indexPath);
  if (!cache.has(indexPath)) {
    try {
      const stat = await NodeFSP.stat(indexPath);
      if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_CLAUDE_INDEX_BYTES) {
        cache.set(indexPath, undefined);
        return undefined;
      }
      const canonicalIndexPath = await NodeFSP.realpath(indexPath);
      if (!isWithin(canonicalRoot, canonicalIndexPath)) {
        cache.set(indexPath, undefined);
        return undefined;
      }
      onIndexRead?.(canonicalIndexPath);
      const parsed: unknown = JSON.parse(await NodeFSP.readFile(canonicalIndexPath, "utf8"));
      if (!isObject(parsed) || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
        cache.set(indexPath, undefined);
        return undefined;
      }
      entriesBySession = new Map();
      for (const candidate of parsed.entries) {
        onIndexEntry?.();
        if (!isObject(candidate) || typeof candidate.sessionId !== "string") continue;
        entriesBySession.set(
          candidate.sessionId,
          entriesBySession.has(candidate.sessionId) ? null : candidate,
        );
      }
      cache.set(indexPath, entriesBySession);
    } catch {
      cache.set(indexPath, undefined);
      return undefined;
    }
  }
  const entry = entriesBySession?.get(location.sessionId);
  if (!entry) return undefined;
  if (
    typeof entry.fullPath !== "string" ||
    typeof entry.projectPath !== "string" ||
    entry.projectPath.length === 0
  ) {
    return undefined;
  }
  let indexedTranscriptPath;
  try {
    indexedTranscriptPath = await NodeFSP.realpath(entry.fullPath);
  } catch {
    return undefined;
  }
  if (indexedTranscriptPath !== location.path || !isWithin(canonicalRoot, indexedTranscriptPath)) {
    return undefined;
  }
  const title =
    typeof entry.summary === "string" && entry.summary ? bounded(entry.summary) : undefined;
  const prompt =
    typeof entry.firstPrompt === "string" && entry.firstPrompt
      ? bounded(entry.firstPrompt)
      : undefined;
  const createdAt = indexTime(entry.created);
  const updatedAt = indexTime(entry.modified) ?? Math.max(0, Math.trunc(location.mtimeMs));
  const messageCount =
    typeof entry.messageCount === "number" &&
    Number.isInteger(entry.messageCount) &&
    entry.messageCount >= 0
      ? entry.messageCount
      : undefined;
  return {
    recordedCwd: entry.projectPath,
    metadata: {
      ...(title ? { title } : {}),
      ...(prompt ? { firstPromptPreview: prompt } : {}),
      ...(createdAt !== undefined ? { createdAt } : {}),
      updatedAt,
      ...(messageCount !== undefined ? { messageCount } : {}),
    },
  };
}

function firstPrompt(records: ReadonlyArray<ClaudeRecord>): string | undefined {
  for (const record of records) {
    if (record.type !== "user" || !record.message) continue;
    const content = record.message.content;
    if (typeof content === "string" && content.trim()) return bounded(content.trim());
    if (!Array.isArray(content)) continue;
    const text = content
      .filter(isObject)
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => String(part.text))
      .join("\n")
      .trim();
    if (text) return bounded(text);
  }
  return undefined;
}

function metadataFromRecords(
  records: ReadonlyArray<ClaudeRecord>,
  fallbackUpdatedAt: number,
): ThreadImportCandidateMetadata {
  const times = records.flatMap((record) => {
    const time = parseTime(record.timestamp);
    return time === undefined ? [] : [time];
  });
  const prompt = firstPrompt(records);
  return {
    ...(prompt ? { title: prompt, firstPromptPreview: prompt } : {}),
    ...(times.length > 0 ? { createdAt: Math.min(...times) } : {}),
    updatedAt: times.length > 0 ? Math.max(...times) : Math.max(0, Math.trunc(fallbackUpdatedAt)),
  };
}

async function discoverCandidates(
  projectsRoot: string,
  provider: ProviderInstanceRef,
  onIndexRead?: (path: string) => void,
  onIndexEntry?: () => void,
): Promise<ReadonlyArray<ThreadImportCandidate>> {
  const locations = await listTranscriptLocations(projectsRoot);
  let canonicalRoot: string;
  try {
    canonicalRoot = await NodeFSP.realpath(projectsRoot);
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  for (const location of locations)
    counts.set(location.sessionId, (counts.get(location.sessionId) ?? 0) + 1);
  const indexCache = new Map<string, IndexedEntryMap | undefined>();
  const candidates: Array<ThreadImportCandidate> = [];
  for (const location of locations) {
    if (seen.has(location.sessionId)) continue;
    if (counts.get(location.sessionId) !== 1) {
      seen.add(location.sessionId);
      continue;
    }
    const indexed = await readIndexedMetadata(
      location,
      canonicalRoot,
      indexCache,
      onIndexRead,
      onIndexEntry,
    );
    if (indexed) {
      seen.add(location.sessionId);
      candidates.push({
        provider,
        nativeThreadId: location.sessionId,
        recordedCwd: indexed.recordedCwd,
        metadata: indexed.metadata,
      });
      continue;
    }
    const records = await readDiscoveryWindows(location);
    const identityRecords = records.filter((record) => record.sessionId !== undefined);
    if (
      identityRecords.length === 0 ||
      identityRecords.some((record) => record.sessionId !== location.sessionId)
    ) {
      continue;
    }
    const recordedCwd = records.find((record) => typeof record.cwd === "string" && record.cwd)?.cwd;
    if (!recordedCwd) continue;
    seen.add(location.sessionId);
    candidates.push({
      provider,
      nativeThreadId: location.sessionId,
      recordedCwd,
      metadata: metadataFromRecords(records, location.mtimeMs),
    });
  }
  return candidates.sort(
    (left, right) =>
      (right.metadata.createdAt ?? 0) - (left.metadata.createdAt ?? 0) ||
      left.nativeThreadId.localeCompare(right.nativeThreadId),
  );
}

const isIgnoredTranscriptRecord = (type: string): boolean =>
  ["summary", "progress", "file-history-snapshot", "queue-operation"].includes(type);

function isStructurallyIncompleteJson(value: string, cause: SyntaxError): boolean {
  let inString = false;
  let escaped = false;
  const stack: Array<string> = [];
  let invalid = false;
  for (const character of value) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{" || character === "[") stack.push(character);
    else if (character === "}") {
      if (stack.at(-1) === "{") stack.pop();
      else invalid = true;
    } else if (character === "]") {
      if (stack.at(-1) === "[") stack.pop();
      else invalid = true;
    }
  }
  if (invalid || (!inString && !escaped && stack.length === 0)) return false;
  if (/unexpected end|unterminated string/i.test(cause.message)) return true;
  const position = /position (\d+)/i.exec(cause.message)?.[1];
  return position !== undefined && Number(position) >= value.length - 1;
}

async function readStableRecords(
  location: TranscriptLocation,
  signal?: AbortSignal,
): Promise<ReadonlyArray<ClaudeRecord>> {
  const handle = await NodeFSP.open(
    location.path,
    NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW,
  );
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > MAX_CLAUDE_TRANSCRIPT_BYTES) {
      throw new Error("transcript size limit exceeded");
    }
    const records: Array<ClaudeRecord> = [];
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const buffer = Buffer.allocUnsafe(TRANSCRIPT_READ_BUFFER_BYTES);
    let pending = "";
    let position = 0;
    const parseLine = (rawLine: string) => {
      if (Buffer.byteLength(rawLine) > MAX_CLAUDE_TRANSCRIPT_LINE_BYTES) {
        throw new Error("transcript line limit exceeded");
      }
      const record = asRecord(JSON.parse(rawLine));
      if (!record) throw new Error("malformed transcript record");
      if (isIgnoredTranscriptRecord(record.type)) return;
      records.push(record);
      if (records.length > MAX_CLAUDE_RETAINED_RECORDS) {
        throw new Error("transcript retained record limit exceeded");
      }
    };
    while (position < before.size) {
      if (signal?.aborted) throw signal.reason ?? new Error("transcript read aborted");
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.byteLength, before.size - position),
        position,
      );
      if (bytesRead === 0) break;
      position += bytesRead;
      pending += decoder.decode(buffer.subarray(0, bytesRead), { stream: position < before.size });
      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        const rawLine = pending.slice(0, newline).replace(/\r$/, "");
        pending = pending.slice(newline + 1);
        if (rawLine) parseLine(rawLine);
        newline = pending.indexOf("\n");
      }
      if (Buffer.byteLength(pending) > MAX_CLAUDE_TRANSCRIPT_LINE_BYTES) {
        throw new Error("transcript line limit exceeded");
      }
    }
    if (pending) {
      try {
        parseLine(pending.replace(/\r$/, ""));
      } catch (cause) {
        if (!(cause instanceof SyntaxError) || !isStructurallyIncompleteJson(pending, cause)) {
          throw cause;
        }
        // Claude may be interrupted while appending its final JSONL record.
      }
    }
    const after = await handle.stat();
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      position !== before.size
    ) {
      throw new Error("transcript changed during read");
    }
    return records;
  } finally {
    await handle.close();
  }
}

function jsonValue(value: unknown, depth = 0): Schema.Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (depth >= 32) return "[unsupported nested value]";
  if (Array.isArray(value)) return value.map((item) => jsonValue(item, depth + 1));
  if (isObject(value)) {
    const output: Record<string, Schema.Json> = {};
    for (const [key, item] of Object.entries(value)) output[key] = jsonValue(item, depth + 1);
    return output;
  }
  return `[unsupported ${typeof value}]`;
}

function textParts(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(isObject)
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => String(part.text))
    .join("\n");
}

function normalizeTranscript(records: ReadonlyArray<ClaudeRecord>, sessionId: string) {
  for (const record of records) {
    if (record.sessionId !== undefined && record.sessionId !== sessionId) {
      throw new Error("session identity mismatch");
    }
  }
  const history: Array<NormalizedThreadImportHistoryItem> = [];
  let sequence = 0;
  let activeTurnId: string | undefined;
  let turnCount = 0;
  let lastAssistantUuid: string | undefined;
  let messageCount = 0;
  let toolCallCount = 0;
  const toolCallOccurrences = new Map<string, number>();
  const pendingToolCalls = new Map<string, Array<string>>();
  const assistantSnapshots = new Map<string, Array<Record<string, unknown>>>();
  const assistantStringSnapshots = new Map<string, string>();
  const assistantToolSnapshots = new Map<
    string,
    Map<string, { readonly historyIndex: number; readonly normalizedCallId: string }>
  >();
  let orphanToolResultCount = 0;
  const encodeToolId = (namespace: "call" | "orphan", nativeId: string, occurrence: number) =>
    `claude-${namespace}:${Buffer.from(nativeId).toString("base64url")}:${occurrence}`;
  const next = () => sequence++;
  const finishTurn = (phase: "completed" | "failed" | "interrupted" = "completed") => {
    if (!activeTurnId) return;
    history.push({ _tag: "TurnLifecycle", sequence: next(), turnId: activeTurnId, phase });
    activeTurnId = undefined;
  };
  for (const record of records) {
    if (record.type === "user" && record.message) {
      if (record.isMeta === true || record.isCompactSummary === true) continue;
      const content = record.message.content;
      const parts = Array.isArray(content) ? content.filter(isObject) : [];
      const ensureUserTurn = () => {
        if (activeTurnId) return;
        activeTurnId = record.uuid ?? `claude-turn-${turnCount}`;
        turnCount += 1;
        history.push({
          _tag: "TurnLifecycle",
          sequence: next(),
          turnId: activeTurnId,
          phase: "started",
        });
      };
      if (parts.some((part) => part.type === "tool_result")) {
        for (const part of parts) {
          if (part.type === "tool_result" && typeof part.tool_use_id === "string") {
            const result = part;
            const callId = String(result.tool_use_id);
            const pending = pendingToolCalls.get(callId);
            const normalizedCallId =
              pending?.shift() ?? encodeToolId("orphan", callId, ++orphanToolResultCount);
            history.push({
              _tag: "ToolResult",
              sequence: next(),
              callId: normalizedCallId,
              output: jsonValue(result.content ?? null),
              isError: result.is_error === true,
            });
          } else if (part.type === "text" && typeof part.text === "string" && part.text) {
            ensureUserTurn();
            messageCount += 1;
            history.push({
              _tag: "Message",
              sequence: next(),
              ...(record.uuid ? { messageId: record.uuid } : {}),
              role: "user",
              text: part.text,
            });
          } else if (part.type === "image") {
            history.push({ _tag: "Activity", sequence: next(), label: "Claude user image" });
          }
        }
        continue;
      }
      finishTurn();
      activeTurnId = record.uuid ?? `claude-turn-${turnCount}`;
      turnCount += 1;
      history.push({
        _tag: "TurnLifecycle",
        sequence: next(),
        turnId: activeTurnId,
        phase: "started",
      });
      const text = textParts(content);
      if (text) {
        messageCount += 1;
        history.push({
          _tag: "Message",
          sequence: next(),
          ...(record.uuid ? { messageId: record.uuid } : {}),
          role: "user",
          text,
        });
      }
      continue;
    }
    if (record.type === "assistant" && record.message) {
      if (!activeTurnId) {
        activeTurnId = record.uuid ?? `claude-turn-${turnCount}`;
        turnCount += 1;
        history.push({
          _tag: "TurnLifecycle",
          sequence: next(),
          turnId: activeTurnId,
          phase: "started",
        });
      }
      if (record.uuid) lastAssistantUuid = record.uuid;
      const content = record.message.content;
      const rawParts = Array.isArray(content) ? content.filter(isObject) : [];
      const priorParts = record.uuid ? assistantSnapshots.get(record.uuid) : undefined;
      const usedPrior = new Set<number>();
      const parts = rawParts.flatMap((part) => {
        if (part.type === "tool_use") return [part];
        const field =
          part.type === "text" ? "text" : part.type === "thinking" ? "thinking" : undefined;
        if (!field || typeof part[field] !== "string" || !priorParts) return [part];
        const value = part[field];
        const exactIndex = priorParts.findIndex(
          (prior, index) =>
            !usedPrior.has(index) && prior.type === part.type && prior[field] === value,
        );
        if (exactIndex >= 0) {
          usedPrior.add(exactIndex);
          return [];
        }
        const prefixIndex = priorParts.findIndex(
          (prior, index) =>
            !usedPrior.has(index) &&
            prior.type === part.type &&
            typeof prior[field] === "string" &&
            value.startsWith(prior[field]),
        );
        if (prefixIndex < 0) return [part];
        usedPrior.add(prefixIndex);
        const priorValue = priorParts[prefixIndex]![field] as string;
        return [{ ...part, [field]: value.slice(priorValue.length) }];
      });
      if (record.uuid) assistantSnapshots.set(record.uuid, rawParts);
      const pushText = (text: string) => {
        if (!text) return;
        messageCount += 1;
        history.push({
          _tag: "Message",
          sequence: next(),
          ...(record.uuid ? { messageId: record.uuid } : {}),
          role: "assistant",
          text,
        });
      };
      if (typeof content === "string") {
        const prior = record.uuid ? assistantStringSnapshots.get(record.uuid) : undefined;
        if (prior !== content)
          pushText(
            prior !== undefined && content.startsWith(prior)
              ? content.slice(prior.length)
              : content,
          );
        if (record.uuid) assistantStringSnapshots.set(record.uuid, content);
      }
      for (const part of parts) {
        if (part.type === "text" && typeof part.text === "string") {
          pushText(part.text);
        } else if (part.type === "thinking" && typeof part.thinking === "string" && part.thinking) {
          history.push({
            _tag: "Reasoning",
            sequence: next(),
            ...(record.uuid ? { activityId: record.uuid } : {}),
            text: part.thinking,
          });
        } else if (
          part.type === "tool_use" &&
          typeof part.id === "string" &&
          typeof part.name === "string"
        ) {
          const snapshotTools = record.uuid
            ? (assistantToolSnapshots.get(record.uuid) ?? new Map())
            : undefined;
          const existing = snapshotTools?.get(part.id);
          if (existing) {
            history[existing.historyIndex] = {
              _tag: "ToolCall",
              sequence: history[existing.historyIndex]!.sequence,
              callId: existing.normalizedCallId,
              name: part.name,
              input: jsonValue(part.input ?? {}),
            };
            continue;
          }
          const occurrence = (toolCallOccurrences.get(part.id) ?? 0) + 1;
          toolCallOccurrences.set(part.id, occurrence);
          const normalizedCallId = encodeToolId("call", part.id, occurrence);
          const pending = pendingToolCalls.get(part.id) ?? [];
          pending.push(normalizedCallId);
          pendingToolCalls.set(part.id, pending);
          toolCallCount += 1;
          const historyIndex = history.length;
          history.push({
            _tag: "ToolCall",
            sequence: next(),
            callId: normalizedCallId,
            name: part.name,
            input: jsonValue(part.input ?? {}),
          });
          if (snapshotTools && record.uuid) {
            snapshotTools.set(part.id, { historyIndex, normalizedCallId });
            assistantToolSnapshots.set(record.uuid, snapshotTools);
          }
        }
      }
      continue;
    }
    if (record.type === "system") {
      if (record.subtype === "api_error" || record.error !== undefined) {
        history.push({
          _tag: "Error",
          sequence: next(),
          ...(record.uuid ? { activityId: record.uuid } : {}),
          message: typeof record.error === "string" ? record.error : "Claude session error",
        });
      }
      continue;
    }
    if (
      record.type === "permission_request" &&
      record.uuid &&
      typeof record.prompt === "string" &&
      ["approved", "denied", "cancelled", "pending"].includes(String(record.decision))
    ) {
      history.push({
        _tag: "Approval",
        sequence: next(),
        activityId: record.uuid,
        prompt: record.prompt,
        decision: record.decision as "approved" | "denied" | "cancelled" | "pending",
      });
      continue;
    }
    if (record.type === "user_input" && record.uuid && typeof record.prompt === "string") {
      history.push({
        _tag: "UserInput",
        sequence: next(),
        activityId: record.uuid,
        prompt: record.prompt,
        ...(typeof record.response === "string" ? { response: record.response } : {}),
      });
      continue;
    }
    if (record.type === "result" && record.subtype?.startsWith("error")) {
      history.push({
        _tag: "Error",
        sequence: next(),
        ...(record.uuid ? { activityId: record.uuid } : {}),
        message: typeof record.error === "string" ? record.error : "Claude session failed",
        code: record.subtype,
      });
      finishTurn("failed");
      continue;
    }
    if (isIgnoredTranscriptRecord(record.type)) {
      continue;
    }
    if (record.uuid) {
      history.push({
        _tag: "Activity",
        sequence: next(),
        activityId: record.uuid,
        label: bounded(`Claude ${record.type}`),
      });
    }
  }
  finishTurn();
  return { history, turnCount, messageCount, toolCallCount, lastAssistantUuid };
}

export const makeClaudeThreadImportSource = Effect.fn("makeClaudeThreadImportSource")(
  function* (options: {
    readonly provider: ProviderInstanceRef;
    readonly claudeSettings: Pick<ClaudeSettings, "homePath">;
    readonly onIndexRead?: (path: string) => void;
    readonly onIndexEntry?: () => void;
  }): Effect.fn.Return<ThreadImportSource, never, Path.Path> {
    const home = yield* resolveClaudeHomePath(options.claudeSettings);
    const projectsRoot = NodePath.join(home, ".claude", "projects");
    const discoveryError = () =>
      new ThreadImportDiscoveryError({
        provider: options.provider,
        code: "claude_discovery_failed",
        retryable: true,
      });
    const loadError = (nativeThreadId: string, code = "claude_load_failed") =>
      new ThreadImportLoadError({
        provider: options.provider,
        nativeThreadId,
        code,
        retryable: true,
      });

    return {
      provider: options.provider,
      discover: Effect.fn("ClaudeThreadImportSource.discover")(function* (input) {
        const cursor = input.cursor;
        const keyset =
          cursor === undefined
            ? undefined
            : isObject(cursor) &&
                Object.keys(cursor).length === 2 &&
                Number.isSafeInteger(cursor.createdAt) &&
                Number(cursor.createdAt) >= 0 &&
                typeof cursor.nativeThreadId === "string" &&
                SESSION_ID.test(cursor.nativeThreadId)
              ? { createdAt: Number(cursor.createdAt), nativeThreadId: cursor.nativeThreadId }
              : null;
        if (keyset === null || !Number.isSafeInteger(input.limit) || input.limit <= 0) {
          return yield* discoveryError();
        }
        const candidates = yield* Effect.tryPromise({
          try: () =>
            discoverCandidates(
              projectsRoot,
              options.provider,
              options.onIndexRead,
              options.onIndexEntry,
            ),
          catch: discoveryError,
        });
        const remaining = keyset
          ? candidates.filter(
              (candidate) =>
                (candidate.metadata.createdAt ?? 0) < keyset.createdAt ||
                ((candidate.metadata.createdAt ?? 0) === keyset.createdAt &&
                  candidate.nativeThreadId.localeCompare(keyset.nativeThreadId) > 0),
            )
          : candidates;
        const page = remaining.slice(0, input.limit);
        const last = page.at(-1);
        return {
          candidates: page,
          ...(last && page.length < remaining.length
            ? {
                nextCursor: {
                  createdAt: last.metadata.createdAt ?? 0,
                  nativeThreadId: last.nativeThreadId,
                },
              }
            : {}),
        };
      }),
      load: Effect.fn("ClaudeThreadImportSource.load")(function* (input) {
        if (!SESSION_ID.test(input.nativeThreadId)) {
          return yield* loadError(input.nativeThreadId, "claude_invalid_session_id");
        }
        const locations = yield* Effect.tryPromise({
          try: () => listTranscriptLocations(projectsRoot),
          catch: () => loadError(input.nativeThreadId),
        });
        const matches = locations.filter((location) => location.sessionId === input.nativeThreadId);
        if (matches.length !== 1) {
          return yield* loadError(input.nativeThreadId, "claude_session_not_unique");
        }
        const records = yield* Effect.tryPromise({
          try: (signal) => readStableRecords(matches[0]!, signal),
          catch: () => loadError(input.nativeThreadId, "claude_snapshot_failed"),
        });
        const recordedCwd = records.find(
          (record) => typeof record.cwd === "string" && record.cwd,
        )?.cwd;
        if (!recordedCwd) return yield* loadError(input.nativeThreadId, "claude_missing_cwd");
        const normalized = yield* Effect.try({
          try: () => normalizeTranscript(records, input.nativeThreadId),
          catch: () => loadError(input.nativeThreadId, "claude_transcript_identity_invalid"),
        });
        const normalizedHistory = yield* decodeHistory(normalized.history).pipe(
          Effect.mapError(() => loadError(input.nativeThreadId, "claude_history_limit_exceeded")),
        );
        const metadata = metadataFromRecords(records, matches[0]!.mtimeMs);
        const times = records.flatMap((record) => {
          const time = parseTime(record.timestamp);
          return time === undefined ? [] : [time];
        });
        return {
          provider: options.provider,
          nativeThreadId: input.nativeThreadId,
          recordedCwd,
          metadata: {
            ...metadata,
            turnCount: normalized.turnCount,
            messageCount: normalized.messageCount,
            toolCallCount: normalized.toolCallCount,
          },
          normalizedHistory,
          resumeCursor: {
            threadId: input.nativeThreadId,
            resume: input.nativeThreadId,
            ...(normalized.lastAssistantUuid
              ? { resumeSessionAt: normalized.lastAssistantUuid }
              : {}),
            turnCount: normalized.turnCount,
          },
          provenance: {
            ...(times.length > 0 ? { nativeCreatedAt: Math.min(...times) } : {}),
            nativeUpdatedAt:
              times.length > 0 ? Math.max(...times) : Math.max(0, Math.trunc(matches[0]!.mtimeMs)),
            sourceFormat: "claude-code-jsonl",
            sourceVersion: "1",
          },
          decoderVersion: DECODER_VERSION,
        };
      }),
    };
  },
);
