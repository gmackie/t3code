import { expect, it } from "@effect/vitest";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import {
  MAX_NORMALIZED_HISTORY_BYTES,
  MAX_NORMALIZED_HISTORY_TEXT_BYTES,
  MAX_NORMALIZED_TOOL_JSON_BYTES,
  MAX_NORMALIZED_TOOL_JSON_DEPTH,
  MAX_NORMALIZED_TOOL_JSON_NODES,
  NormalizedThreadImportHistory,
  ThreadImportProvenance,
} from "./ThreadImportSource.ts";

const decodeHistory = Schema.decodeUnknownExit(NormalizedThreadImportHistory);
const decodeProvenance = Schema.decodeUnknownExit(ThreadImportProvenance);

it("decodes representative normalized Codex history", () => {
  const exit = decodeHistory([
    { _tag: "TurnLifecycle", sequence: 0, turnId: "turn-1", phase: "started" },
    { _tag: "Message", sequence: 1, role: "user", text: "Fix the test" },
    { _tag: "Reasoning", sequence: 2, text: "Inspect the failing assertion" },
    {
      _tag: "ToolCall",
      sequence: 3,
      callId: "call-1",
      name: "exec_command",
      input: { cmd: "vp test" },
    },
    {
      _tag: "ToolResult",
      sequence: 4,
      callId: "call-1",
      output: { exitCode: 0 },
      isError: false,
    },
    { _tag: "Message", sequence: 5, role: "assistant", text: "The test passes." },
    { _tag: "TurnLifecycle", sequence: 6, turnId: "turn-1", phase: "completed" },
  ]);

  expect(Exit.isSuccess(exit)).toBe(true);
});

it("distinguishes failed turn lifecycle from interrupted turns", () => {
  expect(
    Exit.isSuccess(
      decodeHistory([
        { _tag: "TurnLifecycle", sequence: 0, turnId: "turn-failed", phase: "started" },
        { _tag: "TurnLifecycle", sequence: 1, turnId: "turn-failed", phase: "failed" },
      ]),
    ),
  ).toBe(true);
});

it("decodes representative normalized Claude history", () => {
  const exit = decodeHistory([
    { _tag: "TurnLifecycle", sequence: 0, turnId: "turn-2", phase: "started" },
    { _tag: "Message", sequence: 1, role: "user", text: "Apply the change" },
    {
      _tag: "Approval",
      sequence: 2,
      activityId: "approval-1",
      prompt: "Allow editing this file?",
      decision: "approved",
    },
    { _tag: "Message", sequence: 3, role: "assistant", text: "Applied." },
    { _tag: "TurnLifecycle", sequence: 4, turnId: "turn-2", phase: "completed" },
  ]);

  expect(Exit.isSuccess(exit)).toBe(true);
});

it("decodes representative normalized Grok history with safe fallback activity", () => {
  const exit = decodeHistory([
    { _tag: "TurnLifecycle", sequence: 0, turnId: "turn-3", phase: "started" },
    {
      _tag: "UserInput",
      sequence: 1,
      activityId: "input-1",
      prompt: "Choose a target",
      response: "server",
    },
    { _tag: "Activity", sequence: 2, label: "ACP plan update", detail: "Step completed" },
    { _tag: "Error", sequence: 3, message: "Provider warning", code: "warning" },
    { _tag: "TurnLifecycle", sequence: 4, turnId: "turn-3", phase: "interrupted" },
  ]);

  expect(Exit.isSuccess(exit)).toBe(true);
});

it("rejects unordered or duplicate sequence numbers", () => {
  for (const history of [
    [
      { _tag: "Message", sequence: 1, role: "user", text: "first" },
      { _tag: "Message", sequence: 0, role: "assistant", text: "second" },
    ],
    [
      { _tag: "Message", sequence: 0, role: "user", text: "first" },
      { _tag: "Message", sequence: 0, role: "assistant", text: "second" },
    ],
  ]) {
    expect(Exit.isFailure(decodeHistory(history))).toBe(true);
  }
});

it("rejects malformed items and unbounded generic payloads", () => {
  const histories = [
    [{ _tag: "Message", sequence: 0, role: "system", text: "unsupported" }],
    [{ _tag: "ToolResult", sequence: 0, output: {} }],
    [{ _tag: "Activity", sequence: 0, label: "fallback", payload: { raw: "transcript" } }],
  ];

  for (const history of histories) {
    expect(Exit.isFailure(decodeHistory(history))).toBe(true);
  }
});

it("accepts realistic bounded tool payloads", () => {
  const exit = decodeHistory([
    {
      _tag: "ToolCall",
      sequence: 0,
      callId: "call-realistic",
      name: "apply_patch",
      input: {
        patch: "*** Begin Patch\n+small change\n*** End Patch",
        options: { cwd: "/workspace/project", retries: 1 },
      },
    },
    {
      _tag: "ToolResult",
      sequence: 1,
      callId: "call-realistic",
      output: { exitCode: 0, lines: ["updated file", "tests pending"] },
      isError: false,
    },
  ]);

  expect(Exit.isSuccess(exit)).toBe(true);
});

it("rejects oversized tool input and output before serialization", () => {
  const oversized = "x".repeat(MAX_NORMALIZED_TOOL_JSON_BYTES + 1);
  for (const item of [
    {
      _tag: "ToolCall",
      sequence: 0,
      callId: "call-large",
      name: "write",
      input: { value: oversized },
    },
    {
      _tag: "ToolResult",
      sequence: 0,
      callId: "call-large",
      output: { value: oversized },
      isError: false,
    },
  ]) {
    expect(Exit.isFailure(decodeHistory([item]))).toBe(true);
  }
});

it("rejects a wide tool array before reading elements beyond the node budget", () => {
  let elementReads = 0;
  const wide = new Proxy(Array.from({ length: MAX_NORMALIZED_TOOL_JSON_NODES }), {
    get(target, property, receiver) {
      if (typeof property === "string" && /^\d+$/.test(property)) elementReads += 1;
      return Reflect.get(target, property, receiver);
    },
  });

  expect(
    Exit.isFailure(
      decodeHistory([
        { _tag: "ToolCall", sequence: 0, callId: "call-wide", name: "inspect", input: wide },
      ]),
    ),
  ).toBe(true);
  expect(elementReads).toBe(0);
});

it("counts lone UTF-16 surrogates exactly in bounded text", () => {
  for (const loneSurrogate of ["\ud800", "\udc00"]) {
    const atLimit = "x".repeat(MAX_NORMALIZED_HISTORY_TEXT_BYTES - 8) + loneSurrogate;
    const overLimit = "x".repeat(MAX_NORMALIZED_HISTORY_TEXT_BYTES - 7) + loneSurrogate;

    expect(
      Exit.isSuccess(
        decodeHistory([{ _tag: "Message", sequence: 0, role: "user", text: atLimit }]),
      ),
    ).toBe(true);
    expect(
      Exit.isFailure(
        decodeHistory([{ _tag: "Message", sequence: 0, role: "user", text: overLimit }]),
      ),
    ).toBe(true);
  }
});

it("counts lone UTF-16 surrogates exactly in bounded tool JSON", () => {
  for (const loneSurrogate of ["\ud800", "\udc00"]) {
    const atLimit = "x".repeat(MAX_NORMALIZED_TOOL_JSON_BYTES - 8) + loneSurrogate;
    const overLimit = "x".repeat(MAX_NORMALIZED_TOOL_JSON_BYTES - 7) + loneSurrogate;
    const item = (input: string) => ({
      _tag: "ToolCall" as const,
      sequence: 0,
      callId: "call-surrogate",
      name: "inspect",
      input,
    });

    expect(Exit.isSuccess(decodeHistory([item(atLimit)]))).toBe(true);
    expect(Exit.isFailure(decodeHistory([item(overLimit)]))).toBe(true);
  }
});

it("rejects excessively nested or cyclic tool payloads predictably", () => {
  let nested: Record<string, unknown> = {};
  for (let depth = 0; depth <= MAX_NORMALIZED_TOOL_JSON_DEPTH; depth += 1) {
    nested = { child: nested };
  }
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;

  const nonPlainObject = Object.assign(Object.create({ inherited: true }) as object, { value: 1 });

  for (const input of [nested, cyclic, nonPlainObject]) {
    expect(
      Exit.isFailure(
        decodeHistory([
          { _tag: "ToolCall", sequence: 0, callId: "call-deep", name: "inspect", input },
        ]),
      ),
    ).toBe(true);
  }
});

it("rejects oversized text and aggregate history byte budgets", () => {
  expect(
    Exit.isFailure(
      decodeHistory([
        {
          _tag: "Message",
          sequence: 0,
          role: "user",
          text: "x".repeat(MAX_NORMALIZED_HISTORY_TEXT_BYTES + 1),
        },
      ]),
    ),
  ).toBe(true);

  const chunk = "x".repeat(MAX_NORMALIZED_HISTORY_TEXT_BYTES);
  const count = Math.ceil(MAX_NORMALIZED_HISTORY_BYTES / MAX_NORMALIZED_HISTORY_TEXT_BYTES) + 1;
  const history = Array.from({ length: count }, (_, sequence) => ({
    _tag: "Message",
    sequence,
    role: "assistant",
    text: chunk,
  }));
  expect(Exit.isFailure(decodeHistory(history))).toBe(true);
});

it("accepts allowlisted Claude, Codex, and Grok provenance", () => {
  for (const provenance of [
    {
      nativeCreatedAt: 1_700_000_000_000,
      nativeUpdatedAt: 1_700_000_100_000,
      modelLabel: "gpt-5.4",
      parentNativeThreadId: "parent-codex",
      sourceFormat: "codex-app-server",
      sourceVersion: "2",
    },
    { modelLabel: "claude-opus", sourceFormat: "claude-jsonl", sourceVersion: "2026-07" },
    { modelLabel: "grok-build", sourceFormat: "acp", sourceVersion: "1" },
  ]) {
    expect(Exit.isSuccess(decodeProvenance(provenance))).toBe(true);
  }
});

it("rejects raw, path, secret, unknown, and oversized provenance fields", () => {
  for (const provenance of [
    { transcript: [{ role: "user", text: "raw" }] },
    { transcriptPath: "/private/history.jsonl" },
    { credential: "secret-token" },
    { prompt: "raw user prompt" },
    { arbitrary: { extension: true } },
    { modelLabel: "x".repeat(4_097) },
  ]) {
    expect(Exit.isFailure(decodeProvenance(provenance))).toBe(true);
  }
});
