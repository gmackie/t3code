import type { ProviderInstanceRef } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type * as CodexErrors from "effect-codex-app-server/errors";
import type * as CodexRpc from "effect-codex-app-server/rpc";
import * as CodexSchema from "effect-codex-app-server/schema";

import {
  NormalizedThreadImportHistory,
  ThreadImportDiscoveryError,
  ThreadImportLoadError,
  type NormalizedThreadImportHistoryItem,
  type ThreadImportCandidateMetadata,
  type ThreadImportSource,
} from "../ThreadImportSource.ts";

type CodexImportMethod = "thread/list" | "thread/read";

export interface CodexThreadImportClient {
  /**
   * This deliberately returns unknown. Composition should use the app-server raw request seam:
   * generated decoding is performed below after future item variants have crossed the narrow,
   * identity-only compatibility boundary.
   */
  readonly rawRequest: <M extends CodexImportMethod>(
    method: M,
    payload: CodexRpc.ClientRequestParamsByMethod[M],
  ) => Effect.Effect<unknown, CodexErrors.CodexAppServerError>;
}

const decodeListResponse = Schema.decodeUnknownEffect(CodexSchema.V2ThreadListResponse);
const decodeReadResponse = Schema.decodeUnknownEffect(CodexSchema.V2ThreadReadResponse);
const decodeHistory = Schema.decodeUnknownEffect(NormalizedThreadImportHistory);
const DECODER_VERSION = "codex-app-server-v1";
const MAX_CODEX_CURSOR_CHARS = 4_096;
const MAX_CODEX_METADATA_CHARS = 4_096;
const isKnownReadItem = Schema.is(CodexSchema.V2ThreadReadResponse__ThreadItem);
const readProperty = (value: object, key: string): unknown => Reflect.get(value, key);

interface UnknownCodexItem {
  readonly turnId: string;
  readonly id: string;
  readonly type: string;
}

function prepareTolerantReadResponse(value: unknown):
  | {
      readonly decodable: unknown;
      readonly unknownItems: ReadonlyArray<UnknownCodexItem>;
    }
  | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const thread = Reflect.get(value, "thread");
  if (!thread || typeof thread !== "object" || Array.isArray(thread)) return undefined;
  const turns = Reflect.get(thread, "turns");
  if (!Array.isArray(turns)) return undefined;
  const seenTurnIds = new Set<string>();
  for (const turn of turns) {
    if (!turn || typeof turn !== "object" || Array.isArray(turn)) continue;
    const turnId = readProperty(turn, "id");
    if (typeof turnId !== "string") continue;
    if (seenTurnIds.has(turnId)) return undefined;
    seenTurnIds.add(turnId);
    const items = readProperty(turn, "items");
    if (!Array.isArray(items)) continue;
    const seenItemIds = new Set<string>();
    for (const item of items) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const itemId = readProperty(item, "id");
      if (typeof itemId !== "string") continue;
      if (seenItemIds.has(itemId)) return undefined;
      seenItemIds.add(itemId);
    }
  }
  const unknownItems: Array<UnknownCodexItem> = [];
  const preparedTurns = turns.map((turn) => {
    if (!turn || typeof turn !== "object" || Array.isArray(turn)) return turn;
    const turnId = Reflect.get(turn, "id");
    const items = Reflect.get(turn, "items");
    if (typeof turnId !== "string" || !Array.isArray(items)) return turn;
    return {
      ...turn,
      items: items.map((item) => {
        if (isKnownReadItem(item)) return item;
        if (!item || typeof item !== "object" || Array.isArray(item)) return item;
        const id = readProperty(item, "id");
        const type = readProperty(item, "type");
        if (
          typeof id !== "string" ||
          id.length === 0 ||
          id.length > 4_096 ||
          typeof type !== "string" ||
          type.length === 0 ||
          type.length > 4_000
        ) {
          return item;
        }
        unknownItems.push({ turnId, id, type });
        return { id, type: "contextCompaction" };
      }),
    };
  });
  return { decodable: { ...value, thread: { ...thread, turns: preparedTurns } }, unknownItems };
}

const unixSecondsToMilliseconds = (seconds: number): number => seconds * 1_000;
const boundedMetadata = (value: string): string => value.slice(0, MAX_CODEX_METADATA_CHARS);

const metadataFromThread = (
  thread: CodexSchema.V2ThreadListResponse__Thread | CodexSchema.V2ThreadReadResponse__Thread,
): ThreadImportCandidateMetadata => ({
  ...(thread.name ? { title: boundedMetadata(thread.name) } : {}),
  ...(thread.preview ? { firstPromptPreview: boundedMetadata(thread.preview) } : {}),
  createdAt: unixSecondsToMilliseconds(thread.createdAt),
  updatedAt: unixSecondsToMilliseconds(thread.updatedAt),
  turnCount: thread.turns.length,
});

function jsonValue(value: unknown, depth = 0): Schema.Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (depth >= 32) return "[unsupported nested value]";
  if (Array.isArray(value)) return value.map((entry) => jsonValue(entry, depth + 1));
  if (typeof value === "object") {
    const output: Record<string, Schema.Json> = {};
    for (const [key, entry] of Object.entries(value)) output[key] = jsonValue(entry, depth + 1);
    return output;
  }
  return `[unsupported ${typeof value}]`;
}

function userMessageText(
  item: Extract<CodexSchema.V2ThreadReadResponse__ThreadItem, { type: "userMessage" }>,
): string {
  return item.content
    .map((content) => {
      if (content.type === "text") return content.text;
      if (content.type === "image") return "[image]";
      if (content.type === "localImage") return "[local image]";
      if (content.type === "audio") return "[audio]";
      if (content.type === "localAudio") return "[local audio]";
      return `[${content.type}: ${content.name}]`;
    })
    .join("\n");
}

function mapItem(
  item: CodexSchema.V2ThreadReadResponse__ThreadItem,
  next: () => number,
  unknownItem: UnknownCodexItem | undefined,
): ReadonlyArray<NormalizedThreadImportHistoryItem> {
  if (unknownItem) {
    return [
      {
        _tag: "Activity",
        sequence: next(),
        activityId: unknownItem.id,
        label: `Codex ${unknownItem.type}`,
      },
    ];
  }
  switch (item.type) {
    case "userMessage":
      return [
        {
          _tag: "Message",
          sequence: next(),
          messageId: item.id,
          role: "user",
          text: userMessageText(item),
        },
      ];
    case "agentMessage":
      return [
        {
          _tag: "Message",
          sequence: next(),
          messageId: item.id,
          role: "assistant",
          text: item.text,
        },
      ];
    case "reasoning": {
      const text = [...(item.summary ?? []), ...(item.content ?? [])].join("\n");
      return text ? [{ _tag: "Reasoning", sequence: next(), activityId: item.id, text }] : [];
    }
    case "commandExecution":
      return [
        {
          _tag: "ToolCall",
          sequence: next(),
          callId: item.id,
          name: "commandExecution",
          input: { command: item.command },
        },
        ...(item.status === "inProgress"
          ? []
          : [
              {
                _tag: "ToolResult" as const,
                sequence: next(),
                callId: item.id,
                output: {
                  status: item.status,
                  ...(item.exitCode != null ? { exitCode: item.exitCode } : {}),
                  ...(item.aggregatedOutput != null ? { output: item.aggregatedOutput } : {}),
                },
                isError:
                  item.status !== "completed" || (item.exitCode != null && item.exitCode !== 0),
              },
            ]),
      ];
    case "mcpToolCall":
      return [
        {
          _tag: "ToolCall",
          sequence: next(),
          callId: item.id,
          name: `${item.server}/${item.tool}`,
          input: jsonValue(item.arguments),
        },
        ...(item.status === "inProgress"
          ? []
          : [
              {
                _tag: "ToolResult" as const,
                sequence: next(),
                callId: item.id,
                output: jsonValue(item.result ?? item.error ?? null),
                isError: item.status === "failed",
              },
            ]),
      ];
    case "dynamicToolCall":
      return [
        {
          _tag: "ToolCall",
          sequence: next(),
          callId: item.id,
          name: item.tool,
          input: jsonValue(item.arguments),
        },
        ...(item.status === "inProgress"
          ? []
          : [
              {
                _tag: "ToolResult" as const,
                sequence: next(),
                callId: item.id,
                output: jsonValue(item.contentItems ?? null),
                isError: item.status === "failed" || item.success === false,
              },
            ]),
      ];
    case "plan":
      return [
        {
          _tag: "Activity",
          sequence: next(),
          activityId: item.id,
          label: "Plan",
          detail: item.text,
        },
      ];
    case "fileChange":
      return [
        {
          _tag: "ToolCall",
          sequence: next(),
          callId: item.id,
          name: "fileChange",
          input: { changes: jsonValue(item.changes) },
        },
        ...(item.status === "inProgress"
          ? []
          : [
              {
                _tag: "ToolResult" as const,
                sequence: next(),
                callId: item.id,
                output: { status: item.status },
                isError: item.status !== "completed",
              },
            ]),
      ];
    case "hookPrompt":
      return [
        {
          _tag: "Activity",
          sequence: next(),
          activityId: item.id,
          label: "Hook prompt",
          detail: item.fragments.map((fragment) => fragment.text).join("\n"),
        },
      ];
    case "contextCompaction":
      return [
        { _tag: "Activity", sequence: next(), activityId: item.id, label: "Context compacted" },
      ];
    case "enteredReviewMode":
    case "exitedReviewMode":
      return [
        {
          _tag: "Activity",
          sequence: next(),
          activityId: item.id,
          label: item.type === "enteredReviewMode" ? "Entered review mode" : "Exited review mode",
          detail: item.review,
        },
      ];
    case "webSearch":
      return [
        {
          _tag: "Activity",
          sequence: next(),
          activityId: item.id,
          label: "Web search",
          detail: item.query,
        },
      ];
    case "imageView":
      return [{ _tag: "Activity", sequence: next(), activityId: item.id, label: "Viewed image" }];
    case "imageGeneration":
      return [
        {
          _tag: "Activity",
          sequence: next(),
          activityId: item.id,
          label: "Generated image",
          detail: item.status,
        },
      ];
    case "sleep":
      return [
        {
          _tag: "Activity",
          sequence: next(),
          activityId: item.id,
          label: "Waited",
          detail: `${item.durationMs}ms`,
        },
      ];
    case "collabAgentToolCall":
      return [
        {
          _tag: "Activity",
          sequence: next(),
          activityId: item.id,
          label: `Agent ${item.tool}`,
          detail: item.status,
        },
      ];
    case "subAgentActivity":
      return [
        {
          _tag: "Activity",
          sequence: next(),
          activityId: item.id,
          label: `Sub-agent ${item.kind}`,
        },
      ];
  }
}

function normalizeHistory(
  thread: CodexSchema.V2ThreadReadResponse__Thread,
  unknownItems: ReadonlyArray<UnknownCodexItem>,
) {
  let sequence = 0;
  const next = () => sequence++;
  const history: Array<NormalizedThreadImportHistoryItem> = [];
  const unknownByIdentity = new Map<string, UnknownCodexItem>();
  for (const item of unknownItems) {
    const key = `${item.turnId}\0${item.id}`;
    if (unknownByIdentity.has(key)) throw new Error("Duplicate Codex item identity");
    unknownByIdentity.set(key, item);
  }
  for (const turn of thread.turns) {
    history.push({ _tag: "TurnLifecycle", sequence: next(), turnId: turn.id, phase: "started" });
    for (const item of turn.items) {
      const unknownItem = unknownByIdentity.get(`${turn.id}\0${item.id}`);
      history.push(...mapItem(item, next, unknownItem));
    }
    if (turn.error) {
      history.push({
        _tag: "Error",
        sequence: next(),
        activityId: turn.id,
        message: turn.error.message,
      });
    }
    if (turn.status !== "inProgress") {
      history.push({
        _tag: "TurnLifecycle",
        sequence: next(),
        turnId: turn.id,
        phase:
          turn.status === "completed"
            ? "completed"
            : turn.status === "failed"
              ? "failed"
              : "interrupted",
      });
    }
  }
  return history;
}

export const makeCodexThreadImportSource = (options: {
  readonly provider: ProviderInstanceRef;
  readonly client: CodexThreadImportClient;
}): ThreadImportSource => {
  const discoveryError = () =>
    new ThreadImportDiscoveryError({
      provider: options.provider,
      code: "codex_discovery_failed",
      retryable: true,
    });
  const loadError = (nativeThreadId: string, code = "codex_load_failed") =>
    new ThreadImportLoadError({
      provider: options.provider,
      nativeThreadId,
      code,
      retryable: true,
    });

  return {
    provider: options.provider,
    discover: Effect.fn("CodexThreadImportSource.discover")(function* (input) {
      if (
        input.cursor !== undefined &&
        (typeof input.cursor !== "string" ||
          input.cursor.length === 0 ||
          input.cursor.length > MAX_CODEX_CURSOR_CHARS)
      ) {
        return yield* discoveryError();
      }
      const response = yield* options.client
        .rawRequest("thread/list", {
          ...(typeof input.cursor === "string" ? { cursor: input.cursor } : {}),
          limit: input.limit,
          sortDirection: "desc",
          sortKey: "updated_at",
        })
        .pipe(Effect.flatMap(decodeListResponse), Effect.mapError(discoveryError));
      if (
        response.nextCursor !== undefined &&
        response.nextCursor !== null &&
        (response.nextCursor.length === 0 || response.nextCursor.length > MAX_CODEX_CURSOR_CHARS)
      ) {
        return yield* discoveryError();
      }
      return {
        candidates: response.data.map((thread) => ({
          provider: options.provider,
          nativeThreadId: thread.id,
          recordedCwd: thread.cwd,
          metadata: metadataFromThread(thread),
        })),
        ...(response.nextCursor ? { nextCursor: response.nextCursor } : {}),
      };
    }),
    load: Effect.fn("CodexThreadImportSource.load")(function* (input) {
      const rawResponse = yield* options.client
        .rawRequest("thread/read", { threadId: input.nativeThreadId, includeTurns: true })
        .pipe(Effect.mapError(() => loadError(input.nativeThreadId)));
      const prepared = prepareTolerantReadResponse(rawResponse);
      if (!prepared) return yield* loadError(input.nativeThreadId);
      const response = yield* decodeReadResponse(prepared.decodable).pipe(
        Effect.mapError(() => loadError(input.nativeThreadId)),
      );
      if (
        response.thread.id !== input.nativeThreadId ||
        response.thread.turns.some((turn) => turn.itemsView && turn.itemsView !== "full")
      ) {
        return yield* loadError(input.nativeThreadId, "codex_incomplete_history");
      }
      const unvalidatedHistory = yield* Effect.try({
        try: () => normalizeHistory(response.thread, prepared.unknownItems),
        catch: () => loadError(input.nativeThreadId, "codex_history_limit_exceeded"),
      });
      const normalizedHistory = yield* decodeHistory(unvalidatedHistory).pipe(
        Effect.mapError(() => loadError(input.nativeThreadId, "codex_history_limit_exceeded")),
      );
      return {
        provider: options.provider,
        nativeThreadId: response.thread.id,
        recordedCwd: response.thread.cwd,
        metadata: metadataFromThread(response.thread),
        normalizedHistory,
        resumeCursor: { threadId: response.thread.id, resumeRequired: true },
        provenance: {
          nativeCreatedAt: unixSecondsToMilliseconds(response.thread.createdAt),
          nativeUpdatedAt: unixSecondsToMilliseconds(response.thread.updatedAt),
          ...(response.thread.parentThreadId
            ? { parentNativeThreadId: response.thread.parentThreadId }
            : {}),
          sourceFormat: "codex-app-server",
          sourceVersion: response.thread.cliVersion,
        },
        decoderVersion: DECODER_VERSION,
      };
    }),
  };
};
