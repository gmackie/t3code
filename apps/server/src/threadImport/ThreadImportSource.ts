import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { ProviderInstanceRef } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export type ThreadImportJson = Schema.Json;

/** Hard limits applied before imported provider history reaches persistence or orchestration. */
export const MAX_NORMALIZED_HISTORY_ITEMS = 10_000;
export const MAX_NORMALIZED_HISTORY_TEXT_BYTES = 256 * 1_024;
export const MAX_NORMALIZED_HISTORY_BYTES = 8 * 1_024 * 1_024;
export const MAX_NORMALIZED_TOOL_JSON_BYTES = 512 * 1_024;
export const MAX_NORMALIZED_TOOL_JSON_DEPTH = 32;
export const MAX_NORMALIZED_TOOL_JSON_NODES = 10_000;
export const MAX_NORMALIZED_TOOL_JSON_OBJECT_KEYS = 256;

interface JsonResourceLimits {
  readonly maxBytes: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxObjectKeys: number;
}

const jsonStringBytes = (value: string, remainingBytes: number): number | undefined => {
  if (value.length + 2 > remainingBytes) return undefined;
  let bytes = 2;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code === 0x22 ||
      code === 0x5c ||
      code === 0x08 ||
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0c ||
      code === 0x0d
    ) {
      bytes += 2;
    } else if (code <= 0x1f) {
      bytes += 6;
    } else if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 6;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes += 6;
    } else {
      bytes += 3;
    }
    if (bytes > remainingBytes) return undefined;
  }
  return bytes;
};

/** Iterative and cycle-safe so hostile provider values cannot overflow the JS stack. */
const isJsonWithinLimits = (root: unknown, limits: JsonResourceLimits): root is Schema.Json => {
  const stack: Array<{ readonly value: unknown; readonly depth: number }> = [
    { value: root, depth: 0 },
  ];
  const seen = new WeakSet<object>();
  let bytes = 0;
  let nodes = 0;

  while (stack.length > 0) {
    const entry = stack.pop()!;
    nodes += 1;
    if (nodes > limits.maxNodes || entry.depth > limits.maxDepth) return false;
    const value = entry.value;
    if (value === null) {
      bytes += 4;
    } else if (typeof value === "string") {
      const measured = jsonStringBytes(value, limits.maxBytes - bytes);
      if (measured === undefined) return false;
      bytes += measured;
    } else if (typeof value === "boolean") {
      bytes += value ? 4 : 5;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      bytes += String(value).length;
    } else if (typeof value === "object") {
      if (seen.has(value)) return false;
      seen.add(value);
      if (Array.isArray(value)) {
        if (value.length > limits.maxNodes - nodes) return false;
        bytes += 2 + Math.max(0, value.length - 1);
        for (let index = value.length - 1; index >= 0; index -= 1) {
          stack.push({ value: value[index], depth: entry.depth + 1 });
        }
      } else {
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) return false;
        if (Reflect.ownKeys(value).some((key) => typeof key !== "string")) return false;
        const entries = Object.entries(value);
        if (entries.length > limits.maxObjectKeys) return false;
        bytes += 2 + Math.max(0, entries.length - 1);
        for (let index = entries.length - 1; index >= 0; index -= 1) {
          const [key, child] = entries[index]!;
          const keyBytes = jsonStringBytes(key, limits.maxBytes - bytes);
          if (keyBytes === undefined) return false;
          bytes += keyBytes + 1;
          stack.push({ value: child, depth: entry.depth + 1 });
        }
      }
    } else {
      return false;
    }
    if (bytes > limits.maxBytes) return false;
  }
  return true;
};

const toolJsonLimits: JsonResourceLimits = {
  maxBytes: MAX_NORMALIZED_TOOL_JSON_BYTES,
  maxDepth: MAX_NORMALIZED_TOOL_JSON_DEPTH,
  maxNodes: MAX_NORMALIZED_TOOL_JSON_NODES,
  maxObjectKeys: MAX_NORMALIZED_TOOL_JSON_OBJECT_KEYS,
};
const BoundedThreadImportJson = Schema.declare<Schema.Json>(
  (value): value is Schema.Json => isJsonWithinLimits(value, toolJsonLimits),
  { title: "BoundedThreadImportJson" },
);
export type BoundedThreadImportJson = typeof BoundedThreadImportJson.Type;

const sequence = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const boundedIdentifier = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4_096));
const boundedText = Schema.String.check(
  Schema.makeFilter((value) =>
    jsonStringBytes(value, MAX_NORMALIZED_HISTORY_TEXT_BYTES) === undefined
      ? `text must encode to at most ${MAX_NORMALIZED_HISTORY_TEXT_BYTES} bytes`
      : undefined,
  ),
);
const optionalActivityId = { activityId: Schema.optional(boundedIdentifier) };

export const NormalizedThreadImportHistoryItem = Schema.Union([
  Schema.TaggedStruct("TurnLifecycle", {
    sequence,
    turnId: boundedIdentifier,
    phase: Schema.Literals(["started", "completed", "failed", "interrupted"]),
  }).annotate({ parseOptions: { onExcessProperty: "error" } }),
  Schema.TaggedStruct("Message", {
    sequence,
    messageId: Schema.optional(boundedIdentifier),
    role: Schema.Literals(["user", "assistant"]),
    text: boundedText,
  }).annotate({ parseOptions: { onExcessProperty: "error" } }),
  Schema.TaggedStruct("Reasoning", {
    sequence,
    ...optionalActivityId,
    text: boundedText,
  }).annotate({ parseOptions: { onExcessProperty: "error" } }),
  Schema.TaggedStruct("ToolCall", {
    sequence,
    callId: boundedIdentifier,
    name: boundedIdentifier,
    input: BoundedThreadImportJson,
  }).annotate({ parseOptions: { onExcessProperty: "error" } }),
  Schema.TaggedStruct("ToolResult", {
    sequence,
    callId: boundedIdentifier,
    output: BoundedThreadImportJson,
    isError: Schema.Boolean,
  }).annotate({ parseOptions: { onExcessProperty: "error" } }),
  Schema.TaggedStruct("Approval", {
    sequence,
    activityId: boundedIdentifier,
    prompt: boundedText,
    decision: Schema.Literals(["approved", "denied", "cancelled", "pending"]),
  }).annotate({ parseOptions: { onExcessProperty: "error" } }),
  Schema.TaggedStruct("UserInput", {
    sequence,
    activityId: boundedIdentifier,
    prompt: boundedText,
    response: Schema.optional(boundedText),
  }).annotate({ parseOptions: { onExcessProperty: "error" } }),
  Schema.TaggedStruct("Error", {
    sequence,
    ...optionalActivityId,
    message: boundedText,
    code: Schema.optional(boundedIdentifier),
  }).annotate({ parseOptions: { onExcessProperty: "error" } }),
  Schema.TaggedStruct("Activity", {
    sequence,
    ...optionalActivityId,
    label: boundedIdentifier,
    detail: Schema.optional(boundedText),
  }).annotate({ parseOptions: { onExcessProperty: "error" } }),
]);
export type NormalizedThreadImportHistoryItem = typeof NormalizedThreadImportHistoryItem.Type;

export const NormalizedThreadImportHistory = Schema.Array(NormalizedThreadImportHistoryItem).check(
  Schema.isMaxLength(MAX_NORMALIZED_HISTORY_ITEMS),
  Schema.makeFilter((items) =>
    items.every((item, index) => index === 0 || item.sequence > items[index - 1]!.sequence)
      ? undefined
      : "history items must have strictly increasing sequence numbers",
  ),
  Schema.makeFilter((items) =>
    isJsonWithinLimits(items, {
      maxBytes: MAX_NORMALIZED_HISTORY_BYTES,
      maxDepth: MAX_NORMALIZED_TOOL_JSON_DEPTH + 4,
      maxNodes: MAX_NORMALIZED_HISTORY_ITEMS * 16,
      maxObjectKeys: MAX_NORMALIZED_TOOL_JSON_OBJECT_KEYS,
    })
      ? undefined
      : `history must encode to at most ${MAX_NORMALIZED_HISTORY_BYTES} bytes`,
  ),
);
export type NormalizedThreadImportHistory = typeof NormalizedThreadImportHistory.Type;

export const ThreadImportProvenance = Schema.Struct({
  nativeCreatedAt: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  nativeUpdatedAt: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  modelLabel: Schema.optional(boundedIdentifier),
  parentNativeThreadId: Schema.optional(boundedIdentifier),
  sourceFormat: Schema.optional(boundedIdentifier),
  sourceVersion: Schema.optional(boundedIdentifier),
}).annotate({ parseOptions: { onExcessProperty: "error" } });
export type ThreadImportProvenance = typeof ThreadImportProvenance.Type;

export interface ThreadImportDiscoveryInput {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly projectRoot: string;
  readonly cursor?: BoundedThreadImportJson;
  readonly limit: number;
}

export interface ThreadImportCandidateMetadata {
  readonly title?: string;
  readonly firstPromptPreview?: string;
  readonly createdAt?: number;
  readonly updatedAt: number;
  readonly turnCount?: number;
  readonly messageCount?: number;
  readonly toolCallCount?: number;
}

export interface ThreadImportCandidate {
  readonly provider: ProviderInstanceRef;
  readonly nativeThreadId: string;
  readonly recordedCwd: string;
  readonly metadata: ThreadImportCandidateMetadata;
}

export interface ThreadImportDiscoveryPage {
  readonly candidates: ReadonlyArray<ThreadImportCandidate>;
  readonly nextCursor?: BoundedThreadImportJson;
}

export interface LoadedThreadImportSnapshot {
  readonly provider: ProviderInstanceRef;
  readonly nativeThreadId: string;
  readonly recordedCwd: string;
  readonly metadata: ThreadImportCandidateMetadata;
  readonly normalizedHistory: NormalizedThreadImportHistory;
  readonly resumeCursor?: BoundedThreadImportJson;
  readonly provenance: ThreadImportProvenance;
  readonly decoderVersion: string;
}

const threadImportSourceErrorFields = {
  provider: ProviderInstanceRef,
  code: Schema.String,
  retryable: Schema.Boolean,
};

export class ThreadImportDiscoveryError extends Schema.TaggedErrorClass<ThreadImportDiscoveryError>()(
  "ThreadImportDiscoveryError",
  threadImportSourceErrorFields,
) {}

export class ThreadImportLoadError extends Schema.TaggedErrorClass<ThreadImportLoadError>()(
  "ThreadImportLoadError",
  {
    ...threadImportSourceErrorFields,
    nativeThreadId: Schema.String,
  },
) {}

/**
 * Provider-neutral server boundary. Implementations discover lightweight pages first and only
 * load native history for a user-selected identity.
 */
export interface ThreadImportSource {
  readonly provider: ProviderInstanceRef;
  readonly discover: (
    input: ThreadImportDiscoveryInput,
  ) => Effect.Effect<ThreadImportDiscoveryPage, ThreadImportDiscoveryError>;
  readonly load: (input: {
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
    readonly projectRoot: string;
    readonly nativeThreadId: string;
  }) => Effect.Effect<LoadedThreadImportSnapshot, ThreadImportLoadError>;
}
