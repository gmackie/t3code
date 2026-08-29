import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  ExternalThreadImportBatchResult,
  ExternalThreadImportCandidate,
  ExternalThreadImportCandidateToken,
  ExternalThreadImportDiscoveryInput,
  ExternalThreadImportDiscoveryResult,
  EXTERNAL_THREAD_IMPORT_MAX_BATCH_SIZE,
  EXTERNAL_THREAD_IMPORT_MAX_OPAQUE_VALUE_LENGTH,
  ExternalThreadImportProvenance,
  ExternalThreadImportSelection,
} from "./externalThreadImport.ts";
import { WS_METHODS } from "./rpc.ts";

const decodeCandidate = Schema.decodeUnknownSync(ExternalThreadImportCandidate);
const decodeDiscoveryInput = Schema.decodeUnknownSync(ExternalThreadImportDiscoveryInput);
const decodeDiscoveryResult = Schema.decodeUnknownSync(ExternalThreadImportDiscoveryResult);
const encodeDiscoveryResult = Schema.encodeSync(ExternalThreadImportDiscoveryResult);
const decodeSelection = Schema.decodeUnknownSync(ExternalThreadImportSelection);
const decodeBatchResult = Schema.decodeUnknownSync(ExternalThreadImportBatchResult);
const decodeProvenance = Schema.decodeUnknownSync(ExternalThreadImportProvenance);
const encodeProvenance = Schema.encodeSync(ExternalThreadImportProvenance);

describe("ExternalThreadImportCandidateToken", () => {
  const decode = Schema.decodeUnknownSync(ExternalThreadImportCandidateToken);

  it("accepts an opaque non-empty token without exposing path semantics", () => {
    expect(decode("signed.payload.signature")).toBe("signed.payload.signature");
  });

  it.each(["", "   "])("rejects an empty token", (token) => {
    expect(() => decode(token)).toThrow();
  });
});

describe("external thread import discovery contracts", () => {
  it("round-trips candidates from Claude, Codex, and Grok Build instances", () => {
    const candidates = [
      ["claude_work", "claudeAgent"],
      ["codex_personal", "codex"],
      ["grok_build", "grok"],
    ].map(([instanceId, driver], index) => ({
      token: `signed-${index}`,
      provider: { instanceId, driver },
      nativeThreadId: `native-${index}`,
      title: `Thread ${index}`,
      firstPromptPreview: `Prompt ${index}`,
      originalCwd: "/workspace/project",
      createdAt: "2026-07-30T12:00:00.000Z",
      updatedAt: "2026-07-31T12:00:00.000Z",
      turnCount: index + 1,
      messageCount: index + 2,
      toolCallCount: index,
      status: { _tag: "Available" as const },
    }));
    const value = {
      providerResults: candidates.map((candidate) => ({
        _tag: "Success" as const,
        provider: candidate.provider,
        candidates: [candidate],
      })),
      nextCursor: "next-page",
    };

    expect(encodeDiscoveryResult(decodeDiscoveryResult(value))).toEqual(value);
  });

  it("preserves successful candidates when another provider instance fails", () => {
    const decoded = decodeDiscoveryResult({
      providerResults: [
        {
          _tag: "Success",
          provider: { instanceId: "codex", driver: "codex" },
          candidates: [],
        },
        {
          _tag: "Failure",
          provider: { instanceId: "claude_work", driver: "claudeAgent" },
          code: "source_unavailable",
          message: "Claude history is unavailable",
          retryable: true,
        },
      ],
    });

    expect(decoded.providerResults.map((result) => result._tag)).toEqual(["Success", "Failure"]);
  });

  it("rejects invalid discovery scope and pagination input", () => {
    expect(() =>
      decodeDiscoveryInput({ environmentId: "", projectId: "project", limit: 20 }),
    ).toThrow();
    expect(() =>
      decodeDiscoveryInput({ environmentId: "local", projectId: "project", limit: 0 }),
    ).toThrow();
    expect(() =>
      decodeDiscoveryInput({
        environmentId: "local",
        projectId: "project",
        cursor: "   ",
        limit: 20,
      }),
    ).toThrow();
  });

  it("bounds opaque pagination cursors", () => {
    const maxCursor = "x".repeat(EXTERNAL_THREAD_IMPORT_MAX_OPAQUE_VALUE_LENGTH);
    expect(
      decodeDiscoveryInput({
        environmentId: "local",
        projectId: "project",
        cursor: maxCursor,
        limit: 20,
      }).cursor,
    ).toBe(maxCursor);
    expect(() =>
      decodeDiscoveryInput({
        environmentId: "local",
        projectId: "project",
        cursor: `${maxCursor}x`,
        limit: 20,
      }),
    ).toThrow();
  });
});

describe("external thread import selection and results", () => {
  it("publishes provider-neutral websocket method names", () => {
    expect(WS_METHODS.externalThreadsDiscover).toBe("externalThreads.discover");
    expect(WS_METHODS.externalThreadsImport).toBe("externalThreads.import");
  });

  it("rejects an empty selection and invalid tokens", () => {
    expect(() =>
      decodeSelection({ environmentId: "local", projectId: "project", tokens: [] }),
    ).toThrow();
    expect(() =>
      decodeSelection({ environmentId: "local", projectId: "project", tokens: [" "] }),
    ).toThrow();
  });

  it("bounds one import batch to the discovery page size", () => {
    const makeTokens = (length: number) =>
      Array.from({ length }, (_, index) => `candidate-${index}`);
    expect(
      decodeSelection({
        environmentId: "local",
        projectId: "project",
        tokens: makeTokens(EXTERNAL_THREAD_IMPORT_MAX_BATCH_SIZE),
      }).tokens,
    ).toHaveLength(EXTERNAL_THREAD_IMPORT_MAX_BATCH_SIZE);
    expect(() =>
      decodeSelection({
        environmentId: "local",
        projectId: "project",
        tokens: makeTokens(EXTERNAL_THREAD_IMPORT_MAX_BATCH_SIZE + 1),
      }),
    ).toThrow();
  });

  it("decodes imported, duplicate, and failed outcomes in one batch", () => {
    const decoded = decodeBatchResult({
      outcomes: [
        { _tag: "Imported", token: "one", threadId: "t3-one" },
        { _tag: "AlreadyImported", token: "two", threadId: "t3-two" },
        { _tag: "Failed", token: "three", code: "candidate_stale", message: "Retry discovery" },
      ],
    });
    expect(decoded.outcomes.map((outcome) => outcome._tag)).toEqual([
      "Imported",
      "AlreadyImported",
      "Failed",
    ]);
  });

  it("marks already-imported candidates with their T3 thread", () => {
    const candidate = decodeCandidate({
      token: "candidate",
      provider: { instanceId: "codex", driver: "codex" },
      originalCwd: "/workspace/project",
      updatedAt: "2026-07-31T12:00:00.000Z",
      status: { _tag: "AlreadyImported", threadId: "existing-thread" },
    });
    expect(candidate.status).toEqual({ _tag: "AlreadyImported", threadId: "existing-thread" });
  });
});

describe("ExternalThreadImportProvenance", () => {
  const providers = [
    {
      provider: { instanceId: "codex_personal", driver: "codex" },
      resumeCursor: { threadId: "cx-1" },
    },
    {
      provider: { instanceId: "claude_work", driver: "claudeAgent" },
      resumeCursor: { sessionId: "cl-1", forkSession: false },
    },
    {
      provider: { instanceId: "grok_build", driver: "grok" },
      resumeCursor: { sessionId: "gr-1", protocol: { name: "acp", version: 1 } },
    },
  ];

  it.each(providers)("round-trips provider resume metadata", (provider) => {
    const value = makeProvenance(provider);
    expect(encodeProvenance(decodeProvenance(value))).toEqual(value);
  });

  it.each([1n, () => "cursor", Symbol("cursor")])(
    "rejects non-JSON provider resume metadata",
    (resumeCursor) => {
      expect(() => decodeProvenance(makeProvenance({ resumeCursor }))).toThrow();
    },
  );

  it("rejects cyclic provider resume metadata", () => {
    const resumeCursor: Record<string, unknown> = {};
    resumeCursor.self = resumeCursor;
    expect(() => decodeProvenance(makeProvenance({ resumeCursor }))).toThrow();
  });
});

function makeProvenance(overrides: Record<string, unknown>) {
  return {
    provider: { instanceId: "grok_build", driver: "grok" },
    nativeThreadId: "native-session",
    continuationGroup: "provider-local",
    originalCwd: "/workspace/project",
    decoderVersion: "provider-v1",
    importedAt: "2026-07-31T12:30:00.000Z",
    ...overrides,
  };
}
