import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import * as CodexErrors from "effect-codex-app-server/errors";
import * as CodexSchema from "effect-codex-app-server/schema";

import {
  MAX_NORMALIZED_HISTORY_TEXT_BYTES,
  MAX_NORMALIZED_TOOL_JSON_BYTES,
} from "../ThreadImportSource.ts";
import {
  type CodexThreadImportClient,
  makeCodexThreadImportSource,
} from "./CodexThreadImportSource.ts";

const provider = {
  instanceId: ProviderInstanceId.make("codex_personal"),
  driver: ProviderDriverKind.make("codex"),
};
const scope = {
  environmentId: EnvironmentId.make("environment-1"),
  projectId: ProjectId.make("project-1"),
  projectRoot: "/work/project",
};

const baseThread = {
  id: "native-thread-1",
  cliVersion: "1.2.3",
  createdAt: 1_700_000_000,
  updatedAt: 1_700_000_100,
  cwd: "/work/project/packages/server",
  ephemeral: false,
  modelProvider: "openai",
  preview: "Fix the import flow",
  sessionId: "session-1",
  source: "cli" as const,
  status: { type: "idle" as const },
  turns: [],
};

const decodeList = Schema.decodeUnknownSync(CodexSchema.V2ThreadListResponse);
const decodeRead = Schema.decodeUnknownSync(CodexSchema.V2ThreadReadResponse);

function clientWith(
  list: unknown,
  read: unknown = { thread: baseThread },
): { readonly client: CodexThreadImportClient; readonly calls: Array<[string, unknown]> } {
  const calls: Array<[string, unknown]> = [];
  return {
    calls,
    client: {
      rawRequest: (method, params) => {
        calls.push([method, params]);
        return Effect.succeed(method === "thread/list" ? list : read) as never;
      },
    },
  };
}

it.effect("discovers one metadata-only native page and preserves the opaque cursor", () =>
  Effect.gen(function* () {
    const fixture = decodeList({
      data: [{ ...baseThread, name: "Import work" }],
      nextCursor: "c2",
    });
    const { client, calls } = clientWith(fixture);
    const source = makeCodexThreadImportSource({ provider, client });

    const page = yield* source.discover({ ...scope, cursor: "c1", limit: 25 });

    expect(calls).toEqual([
      ["thread/list", { cursor: "c1", limit: 25, sortDirection: "desc", sortKey: "updated_at" }],
    ]);
    expect(page).toEqual({
      candidates: [
        {
          provider,
          nativeThreadId: "native-thread-1",
          recordedCwd: "/work/project/packages/server",
          metadata: {
            title: "Import work",
            firstPromptPreview: "Fix the import flow",
            createdAt: 1_700_000_000_000,
            updatedAt: 1_700_000_100_000,
            turnCount: 0,
          },
        },
      ],
      nextCursor: "c2",
    });
    expect(calls.some(([method]) => method === "thread/start" || method === "thread/resume")).toBe(
      false,
    );
  }),
);

it.effect("loads and normalizes representative full history using thread/read only", () =>
  Effect.gen(function* () {
    const read = decodeRead({
      thread: {
        ...baseThread,
        parentThreadId: "parent-1",
        turns: [
          {
            id: "turn-1",
            status: "completed",
            itemsView: "full",
            items: [
              { id: "u1", type: "userMessage", content: [{ type: "text", text: "Fix it" }] },
              {
                id: "r1",
                type: "reasoning",
                summary: ["Inspect failure"],
                content: ["Trace cause"],
              },
              {
                id: "cmd1",
                type: "commandExecution",
                command: "vp test",
                commandActions: [],
                cwd: "/work/project",
                status: "completed",
                exitCode: 0,
                aggregatedOutput: "ok",
              },
              { id: "a1", type: "agentMessage", text: "Fixed." },
              { id: "compact1", type: "contextCompaction" },
            ],
          },
        ],
      },
    });
    const { client, calls } = clientWith(decodeList({ data: [] }), read);
    const source = makeCodexThreadImportSource({ provider, client });

    const loaded = yield* source.load({ ...scope, nativeThreadId: "native-thread-1" });

    expect(calls).toEqual([["thread/read", { threadId: "native-thread-1", includeTurns: true }]]);
    expect(loaded.normalizedHistory).toEqual([
      { _tag: "TurnLifecycle", sequence: 0, turnId: "turn-1", phase: "started" },
      { _tag: "Message", sequence: 1, messageId: "u1", role: "user", text: "Fix it" },
      { _tag: "Reasoning", sequence: 2, activityId: "r1", text: "Inspect failure\nTrace cause" },
      {
        _tag: "ToolCall",
        sequence: 3,
        callId: "cmd1",
        name: "commandExecution",
        input: { command: "vp test" },
      },
      {
        _tag: "ToolResult",
        sequence: 4,
        callId: "cmd1",
        output: { status: "completed", exitCode: 0, output: "ok" },
        isError: false,
      },
      { _tag: "Message", sequence: 5, messageId: "a1", role: "assistant", text: "Fixed." },
      { _tag: "Activity", sequence: 6, activityId: "compact1", label: "Context compacted" },
      { _tag: "TurnLifecycle", sequence: 7, turnId: "turn-1", phase: "completed" },
    ]);
    expect(loaded.resumeCursor).toEqual({
      threadId: "native-thread-1",
      resumeRequired: true,
    });
    expect(loaded.provenance).toEqual({
      nativeCreatedAt: 1_700_000_000_000,
      nativeUpdatedAt: 1_700_000_100_000,
      parentNativeThreadId: "parent-1",
      sourceFormat: "codex-app-server",
      sourceVersion: "1.2.3",
    });
  }),
);

it.effect("maps provider API failures to typed errors without sensitive payloads", () =>
  Effect.gen(function* () {
    const client: CodexThreadImportClient = {
      rawRequest: () =>
        Effect.fail(CodexErrors.CodexAppServerRequestError.methodNotFound("secret")),
    };
    const source = makeCodexThreadImportSource({ provider, client });
    const discovery = yield* Effect.exit(source.discover({ ...scope, limit: 10 }));
    const load = yield* Effect.exit(source.load({ ...scope, nativeThreadId: "native-thread-1" }));

    expect(Exit.isFailure(discovery)).toBe(true);
    expect(Exit.isFailure(load)).toBe(true);
    if (Exit.isFailure(discovery)) expect(String(discovery.cause)).not.toContain("secret");
    if (Exit.isFailure(load)) expect(String(load.cause)).not.toContain("secret");
  }),
);

it.effect("rejects malformed responses and histories beyond normalized resource limits", () =>
  Effect.gen(function* () {
    const malformed = clientWith({ data: [{ id: "missing-required-fields" }] });
    const malformedExit = yield* Effect.exit(
      makeCodexThreadImportSource({ provider, client: malformed.client }).discover({
        ...scope,
        limit: 10,
      }),
    );
    expect(Exit.isFailure(malformedExit)).toBe(true);

    const oversized = decodeRead({
      thread: {
        ...baseThread,
        turns: [
          {
            id: "turn-large",
            status: "completed",
            items: [
              {
                id: "a-large",
                type: "agentMessage",
                text: "x".repeat(MAX_NORMALIZED_HISTORY_TEXT_BYTES + 1),
              },
            ],
          },
        ],
      },
    });
    const tooLarge = clientWith(decodeList({ data: [] }), oversized);
    const tooLargeExit = yield* Effect.exit(
      makeCodexThreadImportSource({ provider, client: tooLarge.client }).load({
        ...scope,
        nativeThreadId: "native-thread-1",
      }),
    );
    expect(Exit.isFailure(tooLargeExit)).toBe(true);
  }),
);

it.effect("preserves command terminal semantics without inventing in-progress results", () =>
  Effect.gen(function* () {
    const command = (id: string, status: string, exitCode?: number) => ({
      id,
      type: "commandExecution",
      command: id,
      commandActions: [],
      cwd: "/work/project",
      status,
      ...(exitCode === undefined ? {} : { exitCode }),
    });
    const read = decodeRead({
      thread: {
        ...baseThread,
        turns: [
          {
            id: "turn-command",
            status: "completed",
            items: [
              command("running", "inProgress"),
              command("declined", "declined"),
              command("failed", "failed", 1),
              command("success", "completed", 0),
            ],
          },
        ],
      },
    });
    const loaded = yield* makeCodexThreadImportSource({
      provider,
      client: clientWith(decodeList({ data: [] }), read).client,
    }).load({ ...scope, nativeThreadId: "native-thread-1" });

    const results = loaded.normalizedHistory.filter((item) => item._tag === "ToolResult");
    expect(results.map((item) => [item.callId, item.isError])).toEqual([
      ["declined", true],
      ["failed", true],
      ["success", false],
    ]);
  }),
);

it.effect("preserves bounded file changes with call/result correlation", () =>
  Effect.gen(function* () {
    const read = decodeRead({
      thread: {
        ...baseThread,
        turns: [
          {
            id: "turn-file",
            status: "completed",
            items: [
              {
                id: "patch-1",
                type: "fileChange",
                status: "completed",
                changes: [
                  {
                    path: "/work/project/a.ts",
                    diff: "+fixed",
                    kind: { type: "update", move_path: null },
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    const loaded = yield* makeCodexThreadImportSource({
      provider,
      client: clientWith({}, read).client,
    }).load({ ...scope, nativeThreadId: "native-thread-1" });
    expect(loaded.normalizedHistory).toContainEqual({
      _tag: "ToolCall",
      sequence: 1,
      callId: "patch-1",
      name: "fileChange",
      input: {
        changes: [
          { path: "/work/project/a.ts", diff: "+fixed", kind: { type: "update", move_path: null } },
        ],
      },
    });
    expect(loaded.normalizedHistory).toContainEqual({
      _tag: "ToolResult",
      sequence: 2,
      callId: "patch-1",
      output: { status: "completed" },
      isError: false,
    });
  }),
);

it.effect("rejects file changes beyond tool JSON resource bounds", () =>
  Effect.gen(function* () {
    const read = decodeRead({
      thread: {
        ...baseThread,
        turns: [
          {
            id: "turn-file",
            status: "completed",
            items: [
              {
                id: "patch-large",
                type: "fileChange",
                status: "completed",
                changes: [
                  {
                    path: "x".repeat(MAX_NORMALIZED_TOOL_JSON_BYTES + 1),
                    diff: "+large",
                    kind: { type: "add" },
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    const exit = yield* Effect.exit(
      makeCodexThreadImportSource({ provider, client: clientWith({}, read).client }).load({
        ...scope,
        nativeThreadId: "native-thread-1",
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  }),
);

it.effect("maps completed, active, failed, and interrupted turn lifecycle distinctly", () =>
  Effect.gen(function* () {
    const read = decodeRead({
      thread: {
        ...baseThread,
        turns: [
          { id: "complete", status: "completed", items: [] },
          { id: "active", status: "inProgress", items: [] },
          { id: "failed", status: "failed", error: { message: "boom" }, items: [] },
          { id: "interrupted", status: "interrupted", items: [] },
        ],
      },
    });
    const loaded = yield* makeCodexThreadImportSource({
      provider,
      client: clientWith({}, read).client,
    }).load({ ...scope, nativeThreadId: "native-thread-1" });
    expect(loaded.normalizedHistory.filter((item) => item._tag === "TurnLifecycle")).toEqual([
      { _tag: "TurnLifecycle", sequence: 0, turnId: "complete", phase: "started" },
      { _tag: "TurnLifecycle", sequence: 1, turnId: "complete", phase: "completed" },
      { _tag: "TurnLifecycle", sequence: 2, turnId: "active", phase: "started" },
      { _tag: "TurnLifecycle", sequence: 3, turnId: "failed", phase: "started" },
      { _tag: "TurnLifecycle", sequence: 5, turnId: "failed", phase: "failed" },
      { _tag: "TurnLifecycle", sequence: 6, turnId: "interrupted", phase: "started" },
      { _tag: "TurnLifecycle", sequence: 7, turnId: "interrupted", phase: "interrupted" },
    ]);
  }),
);

it.effect("rejects present invalid cursors instead of restarting discovery", () =>
  Effect.gen(function* () {
    for (const cursor of [{ cursor: "nested" }, "x".repeat(4_097)]) {
      const { client, calls } = clientWith(decodeList({ data: [] }));
      const exit = yield* Effect.exit(
        makeCodexThreadImportSource({ provider, client }).discover({ ...scope, cursor, limit: 10 }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      expect(calls).toEqual([]);
    }
  }),
);

it.effect("preserves safe future items as generic activities and rejects malformed identity", () =>
  Effect.gen(function* () {
    const response = {
      thread: {
        ...baseThread,
        turns: [
          {
            id: "future-turn",
            status: "completed",
            items: [{ id: "future-1", type: "futureWidget", secretPayload: { ignored: true } }],
          },
        ],
      },
    };
    const loaded = yield* makeCodexThreadImportSource({
      provider,
      client: clientWith({}, response).client,
    }).load({ ...scope, nativeThreadId: "native-thread-1" });
    expect(loaded.normalizedHistory).toContainEqual({
      _tag: "Activity",
      sequence: 1,
      activityId: "future-1",
      label: "Codex futureWidget",
    });
    const malformed = {
      thread: {
        ...baseThread,
        turns: [{ id: "future-turn", status: "completed", items: [{ type: "futureWidget" }] }],
      },
    };
    const exit = yield* Effect.exit(
      makeCodexThreadImportSource({ provider, client: clientWith({}, malformed).client }).load({
        ...scope,
        nativeThreadId: "native-thread-1",
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);

    const duplicate = {
      thread: {
        ...baseThread,
        turns: [
          {
            id: "future-turn",
            status: "completed",
            items: [
              { id: "duplicate", type: "futureOne" },
              { id: "duplicate", type: "futureTwo" },
            ],
          },
        ],
      },
    };
    const duplicateExit = yield* Effect.exit(
      makeCodexThreadImportSource({ provider, client: clientWith({}, duplicate).client }).load({
        ...scope,
        nativeThreadId: "native-thread-1",
      }),
    );
    expect(Exit.isFailure(duplicateExit)).toBe(true);
  }),
);

it.effect("bounds discovery title and preview metadata", () =>
  Effect.gen(function* () {
    const long = "x".repeat(5_000);
    const fixture = decodeList({ data: [{ ...baseThread, name: long, preview: long }] });
    const page = yield* makeCodexThreadImportSource({
      provider,
      client: clientWith(fixture).client,
    }).discover({ ...scope, limit: 10 });
    expect(page.candidates[0]?.metadata.title?.length).toBe(4_096);
    expect(page.candidates[0]?.metadata.firstPromptPreview?.length).toBe(4_096);
  }),
);

it.effect("preserves MCP and dynamic tool terminal semantics", () =>
  Effect.gen(function* () {
    const read = decodeRead({
      thread: {
        ...baseThread,
        turns: [
          {
            id: "tools",
            status: "completed",
            items: [
              {
                id: "m-running",
                type: "mcpToolCall",
                server: "fs",
                tool: "read",
                arguments: {},
                status: "inProgress",
              },
              {
                id: "m-failed",
                type: "mcpToolCall",
                server: "fs",
                tool: "write",
                arguments: { path: "a" },
                status: "failed",
                error: { message: "denied" },
              },
              {
                id: "d-running",
                type: "dynamicToolCall",
                tool: "search",
                arguments: {},
                status: "inProgress",
              },
              {
                id: "d-failed",
                type: "dynamicToolCall",
                tool: "search",
                arguments: {},
                status: "failed",
                success: false,
                contentItems: [{ type: "inputText", text: "nope" }],
              },
            ],
          },
        ],
      },
    });
    const loaded = yield* makeCodexThreadImportSource({
      provider,
      client: clientWith({}, read).client,
    }).load({ ...scope, nativeThreadId: "native-thread-1" });
    const results = loaded.normalizedHistory.filter((item) => item._tag === "ToolResult");
    expect(results.map((item) => [item.callId, item.isError])).toEqual([
      ["m-failed", true],
      ["d-failed", true],
    ]);
  }),
);

it.effect("uses the explicitly raw app-server request seam", () =>
  Effect.gen(function* () {
    const rawCalls: Array<string> = [];
    const client: CodexThreadImportClient = {
      rawRequest: (method) => {
        rawCalls.push(method);
        return Effect.succeed(
          method === "thread/list" ? decodeList({ data: [] }) : { thread: baseThread },
        );
      },
    };
    const source = makeCodexThreadImportSource({ provider, client });
    yield* source.discover({ ...scope, limit: 10 });
    yield* source.load({ ...scope, nativeThreadId: "native-thread-1" });
    expect(rawCalls).toEqual(["thread/list", "thread/read"]);
  }),
);

it.effect("rejects duplicate turn and item identities before normalization", () =>
  Effect.gen(function* () {
    const cases = [
      [
        { id: "same-turn", status: "completed", items: [] },
        { id: "same-turn", status: "completed", items: [] },
      ],
      [
        {
          id: "turn-known",
          status: "completed",
          items: [
            { id: "same-item", type: "contextCompaction" },
            { id: "same-item", type: "contextCompaction" },
          ],
        },
      ],
      [
        {
          id: "turn-mixed",
          status: "completed",
          items: [
            { id: "same-item", type: "contextCompaction" },
            { id: "same-item", type: "futureWidget" },
          ],
        },
      ],
    ];
    for (const turns of cases) {
      const response = { thread: { ...baseThread, turns } };
      const exit = yield* Effect.exit(
        makeCodexThreadImportSource({ provider, client: clientWith({}, response).client }).load({
          ...scope,
          nativeThreadId: "native-thread-1",
        }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
    }
  }),
);

it.effect("rejects empty and oversized outbound cursors", () =>
  Effect.gen(function* () {
    for (const nextCursor of ["", "x".repeat(4_097)]) {
      const fixture = decodeList({ data: [], nextCursor });
      const exit = yield* Effect.exit(
        makeCodexThreadImportSource({ provider, client: clientWith(fixture).client }).discover({
          ...scope,
          limit: 10,
        }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
    }
  }),
);
