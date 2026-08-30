// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off -- Grok's native JSONL compatibility boundary requires no-follow positioned reads.
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type { GrokSettings, ProviderInstanceRef } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { resolveEffectiveGrokHome } from "../../provider/Drivers/GrokHome.ts";

import {
  NormalizedThreadImportHistory,
  ThreadImportDiscoveryError,
  ThreadImportLoadError,
  type NormalizedThreadImportHistoryItem,
  type ThreadImportCandidate,
  type ThreadImportCandidateMetadata,
  type ThreadImportSource,
} from "../ThreadImportSource.ts";

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SUMMARY_BYTES = 1 * 1_024 * 1_024;
const MAX_CWD_MARKER_BYTES = 16 * 1_024;
const MAX_UPDATES_BYTES = 1 * 1_024 * 1_024 * 1_024;
const MAX_LINE_BYTES = 32 * 1_024 * 1_024;
const MAX_CWD_DIRECTORIES = 10_000;
const MAX_SESSION_DIRECTORIES = 100_000;
const MAX_METADATA_CHARS = 4_096;
const MAX_RETAINED_UPDATE_RECORDS = 20_000;
const MAX_RETAINED_UPDATE_BYTES = 16 * 1_024 * 1_024;
const SUMMARY_READ_CONCURRENCY = 8;
const DECODER_VERSION = "grok-updates-jsonl-v1";
const decodeHistory = Schema.decodeUnknownEffect(NormalizedThreadImportHistory);

type JsonObject = Record<string, unknown>;
interface Location {
  readonly sessionId: string;
  readonly directory: string;
  readonly summaryPath: string;
}
interface Summary {
  readonly info: { readonly id: string; readonly cwd: string };
  readonly title?: string;
  readonly createdAt?: number;
  readonly updatedAt: number;
  readonly messageCount?: number;
  readonly model?: string;
}

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const bounded = (value: string): string => value.slice(0, MAX_METADATA_CHARS);
const parseTime = (value: unknown): number | undefined => {
  if (typeof value !== "string") return undefined;
  const result = Date.parse(value);
  return Number.isFinite(result) && result >= 0 ? result : undefined;
};
const isWithin = (parent: string, child: string): boolean => {
  const relative = NodePath.relative(parent, child);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${NodePath.sep}`));
};
async function listLocations(sessionsRoot: string): Promise<ReadonlyArray<Location>> {
  let root: string;
  try {
    root = await NodeFSP.realpath(sessionsRoot);
  } catch {
    return [];
  }
  const cwdEntries = await NodeFSP.readdir(root, { withFileTypes: true });
  if (cwdEntries.length > MAX_CWD_DIRECTORIES) throw new Error("too many Grok cwd directories");
  const output: Array<Location> = [];
  for (const cwdEntry of cwdEntries) {
    if (!cwdEntry.isDirectory() || cwdEntry.isSymbolicLink()) continue;
    const cwdDirectory = NodePath.join(root, cwdEntry.name);
    const sessionEntries = await NodeFSP.readdir(cwdDirectory, { withFileTypes: true });
    if (output.length + sessionEntries.length > MAX_SESSION_DIRECTORIES)
      throw new Error("too many Grok sessions");
    for (const entry of sessionEntries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !SESSION_ID.test(entry.name)) continue;
      const directory = await NodeFSP.realpath(NodePath.join(cwdDirectory, entry.name));
      if (!isWithin(root, directory)) continue;
      const summaryPath = NodePath.join(directory, "summary.json");
      try {
        const summaryRealPath = await NodeFSP.realpath(summaryPath);
        if (!isWithin(directory, summaryRealPath) || summaryRealPath !== summaryPath) continue;
        output.push({ sessionId: entry.name, directory, summaryPath });
      } catch {
        /* incomplete native session */
      }
    }
  }
  return output;
}

async function discoveryRevision(root: string): Promise<string> {
  let canonicalRoot: string;
  try {
    canonicalRoot = await NodeFSP.realpath(root);
  } catch {
    return "missing";
  }
  const entries = await NodeFSP.readdir(canonicalRoot, { withFileTypes: true });
  const parts = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map(async (entry) => {
        const stat = await NodeFSP.stat(NodePath.join(canonicalRoot, entry.name));
        return `${entry.name}:${stat.mtimeMs}:${stat.size}`;
      }),
  );
  return parts.sort().join("|");
}

async function readSummary(location: Location): Promise<Summary | undefined> {
  const handle = await NodeFSP.open(
    location.summaryPath,
    NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW,
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_SUMMARY_BYTES) return undefined;
    const parsed: unknown = JSON.parse(await handle.readFile("utf8"));
    if (
      !isObject(parsed) ||
      !isObject(parsed.info) ||
      parsed.info.id !== location.sessionId ||
      typeof parsed.info.cwd !== "string" ||
      !NodePath.isAbsolute(parsed.info.cwd)
    )
      return undefined;
    const updatedAt = parseTime(parsed.updated_at) ?? parseTime(parsed.last_active_at);
    if (updatedAt === undefined) return undefined;
    const title =
      typeof parsed.generated_title === "string" && parsed.generated_title.trim()
        ? bounded(parsed.generated_title.trim())
        : typeof parsed.session_summary === "string" && parsed.session_summary.trim()
          ? bounded(parsed.session_summary.trim())
          : undefined;
    const createdAt = parseTime(parsed.created_at);
    const messageCount =
      typeof parsed.num_chat_messages === "number" &&
      Number.isSafeInteger(parsed.num_chat_messages) &&
      parsed.num_chat_messages >= 0
        ? parsed.num_chat_messages
        : undefined;
    const model =
      typeof parsed.current_model_id === "string" && parsed.current_model_id.trim()
        ? bounded(parsed.current_model_id.trim())
        : undefined;
    const groupName = NodePath.basename(NodePath.dirname(location.directory));
    const directGroup = encodeURIComponent(parsed.info.cwd);
    if (groupName !== directGroup) {
      const markerPath = NodePath.join(NodePath.dirname(location.directory), ".cwd");
      let markerHandle: NodeFSP.FileHandle | undefined;
      try {
        markerHandle = await NodeFSP.open(
          markerPath,
          NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW,
        );
        const markerStat = await markerHandle.stat();
        if (!markerStat.isFile() || markerStat.size <= 0 || markerStat.size > MAX_CWD_MARKER_BYTES)
          return undefined;
        const marker = await markerHandle.readFile("utf8");
        const cwd = marker.trimEnd();
        if (!NodePath.isAbsolute(cwd) || cwd !== parsed.info.cwd) return undefined;
      } catch {
        return undefined;
      } finally {
        await markerHandle?.close();
      }
    }
    return {
      info: { id: location.sessionId, cwd: parsed.info.cwd },
      ...(title ? { title } : {}),
      ...(createdAt !== undefined ? { createdAt } : {}),
      updatedAt,
      ...(messageCount !== undefined ? { messageCount } : {}),
      ...(model ? { model } : {}),
    };
  } finally {
    await handle.close();
  }
}

const metadata = (summary: Summary): ThreadImportCandidateMetadata => ({
  ...(summary.title ? { title: summary.title } : {}),
  ...(summary.createdAt !== undefined ? { createdAt: summary.createdAt } : {}),
  updatedAt: summary.updatedAt,
  ...(summary.messageCount !== undefined ? { messageCount: summary.messageCount } : {}),
});

function isStructurallyIncomplete(value: string): boolean {
  let string = false,
    escaped = false;
  const stack: Array<string> = [];
  for (const character of value) {
    if (string) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') string = false;
      continue;
    }
    if (character === '"') string = true;
    else if (character === "{" || character === "[") stack.push(character);
    else if (character === "}" || character === "]") {
      const expected = character === "}" ? "{" : "[";
      if (stack.pop() !== expected) return false;
    }
  }
  return string || stack.length > 0;
}

async function readStableJsonl(
  path: string,
  signal: AbortSignal,
  onRead?: () => void,
): Promise<ReadonlyArray<JsonObject>> {
  onRead?.();
  const handle = await NodeFSP.open(path, NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > MAX_UPDATES_BYTES) throw new Error("updates too large");
    const buffer = Buffer.alloc(64 * 1_024);
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let pending = "",
      position = 0;
    const records: Array<JsonObject> = [];
    let retainedBytes = 0;
    const retain = (raw: string, parsed: JsonObject) => {
      const method = parsed.method;
      if (typeof method === "string" && method.startsWith("x.ai/cache/")) return;
      retainedBytes += Buffer.byteLength(raw);
      records.push(parsed);
      if (records.length > MAX_RETAINED_UPDATE_RECORDS || retainedBytes > MAX_RETAINED_UPDATE_BYTES)
        throw new Error("too many retained updates");
    };
    while (position < before.size) {
      if (signal.aborted) throw signal.reason;
      const read = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, before.size - position),
        position,
      );
      if (read.bytesRead === 0) break;
      position += read.bytesRead;
      pending += decoder.decode(buffer.subarray(0, read.bytesRead), { stream: true });
      if (Buffer.byteLength(pending) > MAX_LINE_BYTES && !pending.includes("\n"))
        throw new Error("line too large");
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const raw of lines) {
        if (!raw.trim()) continue;
        const parsed: unknown = JSON.parse(raw);
        if (!isObject(parsed)) throw new Error("invalid update record");
        retain(raw, parsed);
      }
    }
    pending += decoder.decode();
    if (pending.trim()) {
      try {
        const parsed: unknown = JSON.parse(pending);
        if (!isObject(parsed)) throw new Error("invalid update record");
        retain(pending, parsed);
      } catch (cause) {
        if (!(cause instanceof SyntaxError) || !isStructurallyIncomplete(pending)) throw cause;
      }
    }
    const after = await handle.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || position !== before.size)
      throw new Error("updates changed during read");
    return records;
  } finally {
    await handle.close();
  }
}

function jsonValue(value: unknown, depth = 0): Schema.Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (depth >= 32) return "[unsupported nested value]";
  if (Array.isArray(value)) return value.map((entry) => jsonValue(entry, depth + 1));
  if (isObject(value))
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 256)
        .map(([key, entry]) => [key, jsonValue(entry, depth + 1)]),
    );
  return `[unsupported ${typeof value}]`;
}

function normalize(records: ReadonlyArray<JsonObject>, sessionId: string) {
  const history: Array<NormalizedThreadImportHistoryItem> = [];
  let sequence = 0,
    turnCount = 0,
    messageCount = 0,
    toolCallCount = 0;
  let activeTurn:
    | { readonly logicalId: string; readonly promptIndex?: number; nativePromptId?: string }
    | undefined;
  const submittedNativePromptIds: Array<string | undefined> = [];
  const occurrences = new Map<string, number>();
  const pending = new Map<string, Array<string>>();
  const next = () => sequence++;
  const ensureTurn = (promptIndex?: number) => {
    if (!activeTurn) {
      activeTurn = {
        logicalId:
          promptIndex === undefined ? `grok-turn:${turnCount}` : `grok-prompt:${promptIndex}`,
        ...(promptIndex !== undefined ? { promptIndex } : {}),
        ...(promptIndex !== undefined && submittedNativePromptIds[promptIndex]
          ? { nativePromptId: submittedNativePromptIds[promptIndex] }
          : {}),
      };
      turnCount++;
      history.push({
        _tag: "TurnLifecycle",
        sequence: next(),
        turnId: activeTurn.logicalId,
        phase: "started",
      });
    }
  };
  const finishTurn = (phase: "completed" | "interrupted") => {
    if (!activeTurn) return;
    history.push({
      _tag: "TurnLifecycle",
      sequence: next(),
      turnId: activeTurn.logicalId,
      phase,
    });
    activeTurn = undefined;
  };
  const appendText = (
    tag: "Message" | "Reasoning",
    role: "assistant" | "user" | undefined,
    text: string,
  ) => {
    const last = history.at(-1);
    if (
      last?._tag === tag &&
      (tag !== "Message" || (last._tag === "Message" && last.role === role))
    ) {
      history[history.length - 1] = {
        ...last,
        text: last.text + text,
      } as NormalizedThreadImportHistoryItem;
      return;
    }
    if (tag === "Message") {
      messageCount++;
      history.push({ _tag: "Message", sequence: next(), role: role!, text });
    } else history.push({ _tag: "Reasoning", sequence: next(), text });
  };
  for (const record of records) {
    if (!isObject(record.params) || record.params.sessionId !== sessionId)
      throw new Error("invalid Grok update identity");
    if (
      record.method !== "session/update" &&
      record.method !== "_x.ai/session/update" &&
      record.method !== "x.ai/session/update"
    ) {
      if (
        typeof record.method !== "string" ||
        (!record.method.startsWith("x.ai/") && !record.method.startsWith("_x.ai/"))
      )
        throw new Error("invalid Grok update envelope");
      history.push({
        _tag: "Activity",
        sequence: next(),
        label: bounded(`Grok extension ${record.method.replace(/^_/, "")}`),
      });
      continue;
    }
    if (!isObject(record.params.update) || typeof record.params.update.sessionUpdate !== "string")
      throw new Error("invalid Grok update record");
    const update = record.params.update;
    const kind = String(update.sessionUpdate);
    if (kind === "hook_execution") {
      if (update.event_name === "user_prompt_submit")
        submittedNativePromptIds.push(
          typeof update.prompt_id === "string" && update.prompt_id ? update.prompt_id : undefined,
        );
      else
        history.push({
          _tag: "Activity",
          sequence: next(),
          label: bounded(
            `Grok hook ${typeof update.event_name === "string" ? update.event_name : "execution"}`,
          ),
        });
      continue;
    }
    const promptIndex =
      isObject(update._meta) &&
      Number.isSafeInteger(update._meta.promptIndex) &&
      Number(update._meta.promptIndex) >= 0
        ? Number(update._meta.promptIndex)
        : undefined;
    if (
      kind === "user_message_chunk" &&
      promptIndex !== undefined &&
      activeTurn?.promptIndex !== promptIndex
    ) {
      finishTurn("interrupted");
      ensureTurn(promptIndex);
    } else ensureTurn();
    if (typeof update.prompt_id === "string" && update.prompt_id) {
      if (activeTurn!.nativePromptId && activeTurn!.nativePromptId !== update.prompt_id)
        throw new Error("conflicting native prompt identity");
      activeTurn!.nativePromptId = update.prompt_id;
    }
    const text =
      isObject(update.content) &&
      update.content.type === "text" &&
      typeof update.content.text === "string"
        ? update.content.text
        : undefined;
    if (kind === "user_message_chunk" && text) {
      appendText("Message", "user", text);
    } else if (kind === "agent_message_chunk" && text) {
      appendText("Message", "assistant", text);
    } else if (kind === "agent_thought_chunk" && text) appendText("Reasoning", undefined, text);
    else if (kind === "tool_call" && typeof update.toolCallId === "string" && update.toolCallId) {
      const occurrence = (occurrences.get(update.toolCallId) ?? 0) + 1;
      occurrences.set(update.toolCallId, occurrence);
      const callId = `grok-call:${Buffer.from(update.toolCallId).toString("base64url")}:${occurrence}`;
      const queue = pending.get(update.toolCallId) ?? [];
      queue.push(callId);
      pending.set(update.toolCallId, queue);
      toolCallCount++;
      history.push({
        _tag: "ToolCall",
        sequence: next(),
        callId,
        name: typeof update.title === "string" && update.title ? bounded(update.title) : "Tool",
        input: jsonValue(update.rawInput ?? null),
      });
    } else if (
      kind === "tool_call_update" &&
      typeof update.toolCallId === "string" &&
      (update.status === "completed" || update.status === "failed")
    ) {
      const queue = pending.get(update.toolCallId);
      const callId = queue?.shift();
      if (callId)
        history.push({
          _tag: "ToolResult",
          sequence: next(),
          callId,
          output: jsonValue(update.rawOutput ?? update.content ?? null),
          isError: update.status === "failed",
        });
    } else if (kind === "turn_completed") {
      if (typeof update.prompt_id !== "string" || !update.prompt_id)
        throw new Error("turn completion identity missing");
      finishTurn("completed");
    } else if (kind === "plan")
      history.push({
        _tag: "Activity",
        sequence: next(),
        label: "Grok plan updated",
        detail: JSON.stringify(jsonValue(update.entries ?? [])),
      });
    else if (!["tool_call_update"].includes(kind))
      history.push({
        _tag: "Activity",
        sequence: next(),
        label: bounded(`Grok ${kind.replaceAll("_", " ")}`),
      });
  }
  finishTurn("interrupted");
  return { history, turnCount, messageCount, toolCallCount };
}

export interface GrokThreadImportSourceOptions {
  readonly provider: ProviderInstanceRef;
  readonly grokSettings: Pick<GrokSettings, "homePath">;
  readonly environment?: NodeJS.ProcessEnv;
  readonly onUpdatesRead?: () => void;
  readonly onSummaryReadStart?: () => void;
  readonly onSummaryReadEnd?: () => void;
}

export const makeGrokThreadImportSource = (
  options: GrokThreadImportSourceOptions,
): Effect.Effect<ThreadImportSource> =>
  Effect.sync(() => {
    const sessionsRoot = NodePath.join(
      resolveEffectiveGrokHome({
        configuredHomePath: options.grokSettings.homePath,
        ...(options.environment !== undefined ? { environment: options.environment } : {}),
      }),
      "sessions",
    );
    const discoveryError = () =>
      new ThreadImportDiscoveryError({
        provider: options.provider,
        code: "grok_discovery_failed",
        retryable: true,
      });
    const loadError = (nativeThreadId: string, code = "grok_load_failed") =>
      new ThreadImportLoadError({
        provider: options.provider,
        nativeThreadId,
        code,
        retryable: true,
      });
    const locate = async () => {
      const locations = await listLocations(sessionsRoot);
      const summaries: Array<{ location: Location; summary: Summary | undefined }> = [];
      let cursor = 0;
      const workers = Array.from(
        { length: Math.min(SUMMARY_READ_CONCURRENCY, locations.length) },
        async () => {
          while (cursor < locations.length) {
            const location = locations[cursor++]!;
            options.onSummaryReadStart?.();
            try {
              summaries.push({ location, summary: await readSummary(location) });
            } finally {
              options.onSummaryReadEnd?.();
            }
          }
        },
      );
      await Promise.all(workers);
      return summaries.filter(
        (entry): entry is { location: Location; summary: Summary } => entry.summary !== undefined,
      );
    };
    let discoveryCache:
      | {
          readonly revision: string;
          readonly promise: ReturnType<typeof locate>;
        }
      | undefined;
    const cachedEntries = async () => {
      const revision = await discoveryRevision(sessionsRoot);
      if (discoveryCache && discoveryCache.revision === revision) return discoveryCache.promise;
      const promise = locate();
      const entry = { revision, promise };
      discoveryCache = entry;
      void promise.catch(() => {
        if (discoveryCache === entry) discoveryCache = undefined;
      });
      return promise;
    };
    return {
      provider: options.provider,
      discover: Effect.fn("GrokThreadImportSource.discover")(function* (input) {
        const cursor = input.cursor;
        const keyset =
          cursor === undefined
            ? undefined
            : isObject(cursor) &&
                Object.keys(cursor).length === 2 &&
                Number.isSafeInteger(cursor.updatedAt) &&
                Number(cursor.updatedAt) >= 0 &&
                typeof cursor.nativeThreadId === "string" &&
                SESSION_ID.test(cursor.nativeThreadId)
              ? { updatedAt: Number(cursor.updatedAt), nativeThreadId: cursor.nativeThreadId }
              : null;
        if (keyset === null || !Number.isSafeInteger(input.limit) || input.limit <= 0)
          return yield* discoveryError();
        const entries = yield* Effect.tryPromise({ try: cachedEntries, catch: discoveryError });
        const counts = new Map<string, number>();
        for (const entry of entries)
          counts.set(entry.location.sessionId, (counts.get(entry.location.sessionId) ?? 0) + 1);
        const candidates: Array<ThreadImportCandidate> = entries
          .filter((entry) => counts.get(entry.location.sessionId) === 1)
          .map(({ location, summary }) => ({
            provider: options.provider,
            nativeThreadId: location.sessionId,
            recordedCwd: summary.info.cwd,
            metadata: metadata(summary),
          }))
          .sort(
            (a, b) =>
              b.metadata.updatedAt - a.metadata.updatedAt ||
              a.nativeThreadId.localeCompare(b.nativeThreadId),
          );
        const remaining = keyset
          ? candidates.filter(
              (candidate) =>
                candidate.metadata.updatedAt < keyset.updatedAt ||
                (candidate.metadata.updatedAt === keyset.updatedAt &&
                  candidate.nativeThreadId.localeCompare(keyset.nativeThreadId) > 0),
            )
          : candidates;
        const page = remaining.slice(0, input.limit),
          last = page.at(-1);
        return {
          candidates: page,
          ...(last && page.length < remaining.length
            ? {
                nextCursor: {
                  updatedAt: last.metadata.updatedAt,
                  nativeThreadId: last.nativeThreadId,
                },
              }
            : {}),
        };
      }),
      load: Effect.fn("GrokThreadImportSource.load")(function* (input) {
        if (!SESSION_ID.test(input.nativeThreadId))
          return yield* loadError(input.nativeThreadId, "grok_invalid_session_id");
        const entries = yield* Effect.tryPromise({
          try: locate,
          catch: () => loadError(input.nativeThreadId),
        });
        const matches = entries.filter(
          (entry) => entry.location.sessionId === input.nativeThreadId,
        );
        if (matches.length !== 1)
          return yield* loadError(input.nativeThreadId, "grok_session_not_unique");
        const match = matches[0]!;
        const records = yield* Effect.tryPromise({
          try: (signal) =>
            readStableJsonl(
              NodePath.join(match.location.directory, "updates.jsonl"),
              signal,
              options.onUpdatesRead,
            ),
          catch: () => loadError(input.nativeThreadId, "grok_snapshot_failed"),
        });
        const normalized = yield* Effect.try({
          try: () => normalize(records, input.nativeThreadId),
          catch: () => loadError(input.nativeThreadId, "grok_updates_invalid"),
        });
        const normalizedHistory = yield* decodeHistory(normalized.history).pipe(
          Effect.mapError(() => loadError(input.nativeThreadId, "grok_history_limit_exceeded")),
        );
        return {
          provider: options.provider,
          nativeThreadId: input.nativeThreadId,
          recordedCwd: match.summary.info.cwd,
          metadata: {
            ...metadata(match.summary),
            turnCount: normalized.turnCount,
            messageCount: normalized.messageCount,
            toolCallCount: normalized.toolCallCount,
          },
          normalizedHistory,
          resumeCursor: { schemaVersion: 1, sessionId: input.nativeThreadId },
          provenance: {
            ...(match.summary.createdAt !== undefined
              ? { nativeCreatedAt: match.summary.createdAt }
              : {}),
            nativeUpdatedAt: match.summary.updatedAt,
            ...(match.summary.model ? { modelLabel: match.summary.model } : {}),
            sourceFormat: "grok-updates-jsonl",
            sourceVersion: "1",
          },
          decoderVersion: DECODER_VERSION,
        };
      }),
    };
  });
