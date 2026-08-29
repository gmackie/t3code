// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off -- Synthetic filesystem fixtures exercise the native Claude JSONL boundary.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import { makeClaudeThreadImportSource } from "./ClaudeThreadImportSource.ts";

const provider = {
  instanceId: ProviderInstanceId.make("claude_work"),
  driver: ProviderDriverKind.make("claudeAgent"),
};
const scope = {
  environmentId: EnvironmentId.make("environment-1"),
  projectId: ProjectId.make("project-1"),
  projectRoot: "/work/project",
};
const session1 = "550e8400-e29b-41d4-a716-446655440000";
const session2 = "660e8400-e29b-41d4-a716-446655440000";
const session3 = "770e8400-e29b-41d4-a716-446655440000";

const line = (value: unknown) => `${JSON.stringify(value)}\n`;
const callId = (nativeId: string, occurrence: number) =>
  `claude-call:${Buffer.from(nativeId).toString("base64url")}:${occurrence}`;
const orphanId = (nativeId: string, occurrence: number) =>
  `claude-orphan:${Buffer.from(nativeId).toString("base64url")}:${occurrence}`;

const user = (input: {
  sessionId?: string;
  uuid: string;
  parentUuid?: string | null;
  cwd?: string;
  timestamp?: string;
  content: unknown;
}) => ({
  type: "user",
  sessionId: input.sessionId ?? session1,
  uuid: input.uuid,
  parentUuid: input.parentUuid ?? null,
  cwd: input.cwd ?? "/work/project/packages/server",
  timestamp: input.timestamp ?? "2026-01-02T03:04:05.000Z",
  message: { role: "user", content: input.content },
});

const assistant = (input: {
  uuid: string;
  parentUuid: string;
  content: unknown;
  timestamp?: string;
}) => ({
  type: "assistant",
  sessionId: session1,
  uuid: input.uuid,
  parentUuid: input.parentUuid,
  cwd: "/work/project/packages/server",
  timestamp: input.timestamp ?? "2026-01-02T03:04:06.000Z",
  message: { role: "assistant", content: input.content },
});

const withHome = <A, E, R>(run: (home: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(process.cwd(), ".claude-import-test-"))),
    run,
    (home) => Effect.promise(() => NodeFSP.rm(home, { recursive: true, force: true })),
  );

const writeTranscript = (home: string, directory: string, sessionId: string, contents: string) =>
  Effect.promise(async () => {
    const projectDirectory = NodePath.join(home, ".claude", "projects", directory);
    await NodeFSP.mkdir(projectDirectory, { recursive: true });
    const transcriptPath = NodePath.join(projectDirectory, `${sessionId}.jsonl`);
    await NodeFSP.writeFile(transcriptPath, contents);
    return transcriptPath;
  });

it.layer(NodeServices.layer)("ClaudeThreadImportSource", (it) => {
  it.effect("discovers configured-home sessions by recorded cwd with stable pagination", () =>
    withHome((home) =>
      Effect.gen(function* () {
        yield* writeTranscript(
          home,
          "encoded-name-is-not-trusted",
          session1,
          line(user({ uuid: "u1", content: "Older prompt" })),
        );
        yield* writeTranscript(
          home,
          "also-not-a-cwd",
          session2,
          line(
            user({
              sessionId: session2,
              uuid: "u2",
              cwd: "/elsewhere/repository",
              timestamp: "2026-01-03T03:04:05.000Z",
              content: "Newer prompt",
            }),
          ),
        );
        const source = yield* makeClaudeThreadImportSource({
          provider,
          claudeSettings: { homePath: home },
        });

        const first = yield* source.discover({ ...scope, limit: 1 });
        expect(first.nextCursor).toBeDefined();
        yield* Effect.promise(() =>
          NodeFSP.appendFile(
            NodePath.join(
              home,
              ".claude",
              "projects",
              "encoded-name-is-not-trusted",
              `${session1}.jsonl`,
            ),
            line(
              assistant({
                uuid: "a-updated",
                parentUuid: "u1",
                timestamp: "2026-01-05T03:04:05.000Z",
                content: "Updated after page one",
              }),
            ),
          ),
        );
        yield* writeTranscript(
          home,
          "inserted",
          session3,
          line(
            user({
              sessionId: session3,
              uuid: "u3",
              timestamp: "2026-01-04T03:04:05.000Z",
              content: "Inserted later",
            }),
          ),
        );
        const second = yield* source.discover({ ...scope, limit: 1, cursor: first.nextCursor! });

        expect(first.candidates.map((candidate) => candidate.nativeThreadId)).toEqual([session2]);
        expect(first.candidates[0]?.recordedCwd).toBe("/elsewhere/repository");
        expect(first.candidates[0]?.metadata.firstPromptPreview).toBe("Newer prompt");
        expect(second.candidates.map((candidate) => candidate.nativeThreadId)).toEqual([session1]);
        expect(second.nextCursor).toBeUndefined();
      }),
    ),
  );

  it.effect("rejects malformed keyset cursors", () =>
    withHome((home) =>
      Effect.gen(function* () {
        const source = yield* makeClaudeThreadImportSource({
          provider,
          claudeSettings: { homePath: home },
        });
        for (const cursor of [
          { offset: 1 },
          { createdAt: -1, nativeThreadId: session1 },
          { createdAt: 1, nativeThreadId: "bad" },
        ]) {
          expect(
            Exit.isFailure(yield* Effect.exit(source.discover({ ...scope, limit: 10, cursor }))),
          ).toBe(true);
        }
      }),
    ),
  );

  it.effect("prefers the native sessions index without parsing transcript history", () =>
    withHome((home) =>
      Effect.gen(function* () {
        const transcriptPath = yield* writeTranscript(
          home,
          "indexed",
          session1,
          "this transcript is intentionally not valid JSONL",
        );
        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            NodePath.join(home, ".claude", "projects", "indexed", "sessions-index.json"),
            JSON.stringify({
              version: 1,
              entries: [
                {
                  sessionId: session1,
                  fullPath: transcriptPath,
                  projectPath: "/work/project/from-index",
                  firstPrompt: "Indexed prompt",
                  summary: "Indexed title",
                  created: "2026-01-01T00:00:00.000Z",
                  modified: "2026-01-04T00:00:00.000Z",
                  messageCount: 9,
                },
              ],
            }),
          ),
        );
        const source = yield* makeClaudeThreadImportSource({
          provider,
          claudeSettings: { homePath: home },
        });

        const page = yield* source.discover({ ...scope, limit: 10 });

        expect(page.candidates).toEqual([
          {
            provider,
            nativeThreadId: session1,
            recordedCwd: "/work/project/from-index",
            metadata: {
              title: "Indexed title",
              firstPromptPreview: "Indexed prompt",
              createdAt: Date.parse("2026-01-01T00:00:00.000Z"),
              updatedAt: Date.parse("2026-01-04T00:00:00.000Z"),
              messageCount: 9,
            },
          },
        ]);
      }),
    ),
  );

  it.effect("reads each project directory index once during discovery", () =>
    withHome((home) =>
      Effect.gen(function* () {
        const firstPath = yield* writeTranscript(home, "shared-index", session1, "invalid");
        const secondPath = yield* writeTranscript(home, "shared-index", session2, "invalid");
        const indexPath = NodePath.join(
          home,
          ".claude",
          "projects",
          "shared-index",
          "sessions-index.json",
        );
        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            indexPath,
            JSON.stringify({
              version: 1,
              entries: [
                {
                  sessionId: session1,
                  fullPath: firstPath,
                  projectPath: "/work/project",
                  created: 1,
                  modified: 2,
                },
                {
                  sessionId: session2,
                  fullPath: secondPath,
                  projectPath: "/work/project",
                  created: 1,
                  modified: 2,
                },
              ],
            }),
          ),
        );
        const reads: Array<string> = [];
        let entryVisits = 0;
        const source = yield* makeClaudeThreadImportSource({
          provider,
          claudeSettings: { homePath: home },
          onIndexRead: (path) => reads.push(path),
          onIndexEntry: () => {
            entryVisits += 1;
          },
        });
        const page = yield* source.discover({ ...scope, limit: 10 });
        expect(page.candidates).toHaveLength(2);
        expect(reads).toEqual([indexPath]);
        expect(entryVisits).toBe(2);
      }),
    ),
  );

  it.effect(
    "loads complete text, thinking, tool, unknown activity, and turn lifecycle history",
    () =>
      withHome((home) =>
        Effect.gen(function* () {
          const transcript = [
            user({ uuid: "u1", content: [{ type: "text", text: "Fix it" }] }),
            assistant({
              uuid: "a1",
              parentUuid: "u1",
              content: [
                { type: "thinking", thinking: "Inspect carefully" },
                { type: "text", text: "I will inspect." },
                { type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "src/a.ts" } },
              ],
            }),
            user({
              uuid: "u-result",
              parentUuid: "a1",
              content: [{ type: "tool_result", tool_use_id: "tool-1", content: "contents" }],
            }),
            assistant({
              uuid: "a2",
              parentUuid: "u-result",
              content: [{ type: "text", text: "Fixed." }],
            }),
            {
              type: "future_optional",
              sessionId: session1,
              uuid: "optional-1",
              parentUuid: "a2",
              cwd: "/work/project/packages/server",
              timestamp: "2026-01-02T03:04:07.000Z",
            },
          ]
            .map(line)
            .join("");
          yield* writeTranscript(home, "fixture", session1, transcript);
          const source = yield* makeClaudeThreadImportSource({
            provider,
            claudeSettings: { homePath: home },
          });

          const loaded = yield* source.load({ ...scope, nativeThreadId: session1 });

          expect(loaded.recordedCwd).toBe("/work/project/packages/server");
          expect(loaded.resumeCursor).toEqual({
            threadId: session1,
            resume: session1,
            resumeSessionAt: "a2",
            turnCount: 1,
          });
          expect(loaded.normalizedHistory).toEqual([
            { _tag: "TurnLifecycle", sequence: 0, turnId: "u1", phase: "started" },
            { _tag: "Message", sequence: 1, messageId: "u1", role: "user", text: "Fix it" },
            { _tag: "Reasoning", sequence: 2, activityId: "a1", text: "Inspect carefully" },
            {
              _tag: "Message",
              sequence: 3,
              messageId: "a1",
              role: "assistant",
              text: "I will inspect.",
            },
            {
              _tag: "ToolCall",
              sequence: 4,
              callId: callId("tool-1", 1),
              name: "Read",
              input: { file_path: "src/a.ts" },
            },
            {
              _tag: "ToolResult",
              sequence: 5,
              callId: callId("tool-1", 1),
              output: "contents",
              isError: false,
            },
            { _tag: "Message", sequence: 6, messageId: "a2", role: "assistant", text: "Fixed." },
            {
              _tag: "Activity",
              sequence: 7,
              activityId: "optional-1",
              label: "Claude future_optional",
            },
            { _tag: "TurnLifecycle", sequence: 8, turnId: "u1", phase: "completed" },
          ]);
          expect(loaded.provenance).toEqual({
            nativeCreatedAt: Date.parse("2026-01-02T03:04:05.000Z"),
            nativeUpdatedAt: Date.parse("2026-01-02T03:04:07.000Z"),
            sourceFormat: "claude-code-jsonl",
            sourceVersion: "1",
          });
        }),
      ),
  );

  it.effect("tolerates one incomplete final line but rejects interior corruption", () =>
    withHome((home) =>
      Effect.gen(function* () {
        yield* writeTranscript(
          home,
          "truncated",
          session1,
          `${line(user({ uuid: "u1", content: "Hello" }))}{"type":"assistant"`,
        );
        const source = yield* makeClaudeThreadImportSource({
          provider,
          claudeSettings: { homePath: home },
        });
        const loaded = yield* source.load({ ...scope, nativeThreadId: session1 });
        expect(loaded.normalizedHistory.some((item) => item._tag === "Message")).toBe(true);

        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            NodePath.join(home, ".claude", "projects", "truncated", `${session1}.jsonl`),
            `${line(user({ uuid: "u1", content: "Hello" }))}{broken}\n${line(
              assistant({ uuid: "a1", parentUuid: "u1", content: "No" }),
            )}`,
          ),
        );
        const failed = yield* Effect.exit(source.load({ ...scope, nativeThreadId: session1 }));
        expect(Exit.isFailure(failed)).toBe(true);
      }),
    ),
  );

  it.effect("loads a complete final JSON record without requiring a trailing newline", () =>
    withHome((home) =>
      Effect.gen(function* () {
        yield* writeTranscript(
          home,
          "no-newline",
          session1,
          JSON.stringify(user({ uuid: "u1", content: "Complete" })),
        );
        const source = yield* makeClaudeThreadImportSource({
          provider,
          claudeSettings: { homePath: home },
        });
        const loaded = yield* source.load({ ...scope, nativeThreadId: session1 });
        expect(loaded.normalizedHistory.some((item) => item._tag === "Message")).toBe(true);
      }),
    ),
  );

  it.effect(
    "rejects malformed complete final tokens while tolerating structurally incomplete tails",
    () =>
      withHome((home) =>
        Effect.gen(function* () {
          const source = yield* makeClaudeThreadImportSource({
            provider,
            claudeSettings: { homePath: home },
          });
          for (const [index, tail] of ["{broken}", "not-json", '{"type": nope}'].entries()) {
            yield* writeTranscript(
              home,
              `malformed-${index}`,
              session1,
              `${line(user({ uuid: "u1", content: "ok" }))}${tail}`,
            );
            expect(
              Exit.isFailure(
                yield* Effect.exit(source.load({ ...scope, nativeThreadId: session1 })),
              ),
            ).toBe(true);
            yield* Effect.promise(() =>
              NodeFSP.rm(NodePath.join(home, ".claude", "projects", `malformed-${index}`), {
                recursive: true,
              }),
            );
          }
          for (const [index, tail] of [
            '{"type":"assistant"',
            '{"type":"assistant","message":{"content":"open',
            '{"type":"assistant","value":"escape\\',
          ].entries()) {
            yield* writeTranscript(
              home,
              `incomplete-${index}`,
              session1,
              `${line(user({ uuid: "u1", content: "ok" }))}${tail}`,
            );
            const loaded = yield* source.load({ ...scope, nativeThreadId: session1 });
            expect(loaded.metadata.messageCount).toBe(1);
            yield* Effect.promise(() =>
              NodeFSP.rm(NodePath.join(home, ".claude", "projects", `incomplete-${index}`), {
                recursive: true,
              }),
            );
          }
        }),
      ),
  );

  it.effect("preserves file order when parents are forward or missing", () =>
    withHome((home) =>
      Effect.gen(function* () {
        yield* writeTranscript(
          home,
          "order",
          session1,
          `${line(assistant({ uuid: "a1", parentUuid: "u1", content: "Early" }))}${line(
            user({ uuid: "u1", content: "Late" }),
          )}`,
        );
        const source = yield* makeClaudeThreadImportSource({
          provider,
          claudeSettings: { homePath: home },
        });
        const loaded = yield* source.load({ ...scope, nativeThreadId: session1 });
        expect(
          loaded.normalizedHistory
            .filter((item) => item._tag === "Message")
            .map((item) => item.text),
        ).toEqual(["Early", "Late"]);
      }),
    ),
  );

  it.effect(
    "preserves duplicate record identities while rejecting traversal ids and escaping symlinks",
    () =>
      withHome((home) =>
        Effect.gen(function* () {
          yield* writeTranscript(
            home,
            "duplicate",
            session1,
            `${line(user({ uuid: "same", content: "One" }))}${line(
              assistant({ uuid: "same", parentUuid: "same", content: "Two" }),
            )}`,
          );
          const source = yield* makeClaudeThreadImportSource({
            provider,
            claudeSettings: { homePath: home },
          });
          const loaded = yield* source.load({ ...scope, nativeThreadId: session1 });
          expect(
            loaded.normalizedHistory
              .filter((item) => item._tag === "Message")
              .map((item) => item.text),
          ).toEqual(["One", "Two"]);
          expect(
            Exit.isFailure(
              yield* Effect.exit(source.load({ ...scope, nativeThreadId: "../../secret" })),
            ),
          ).toBe(true);

          const outside = NodePath.join(home, "outside.jsonl");
          yield* Effect.promise(() =>
            NodeFSP.writeFile(
              outside,
              line(user({ sessionId: session2, uuid: "u2", content: "Secret" })),
            ),
          );
          const projectDirectory = NodePath.join(home, ".claude", "projects", "link");
          yield* Effect.promise(async () => {
            await NodeFSP.mkdir(projectDirectory, { recursive: true });
            await NodeFSP.symlink(outside, NodePath.join(projectDirectory, `${session2}.jsonl`));
          });
          expect(
            Exit.isFailure(yield* Effect.exit(source.load({ ...scope, nativeThreadId: session2 }))),
          ).toBe(true);
        }),
      ),
  );

  it.effect("streams transcripts larger than 16 MiB and skips large progress records", () =>
    withHome((home) =>
      Effect.gen(function* () {
        const ignored = line({ type: "progress", data: "x".repeat(2 * 1_024 * 1_024) });
        yield* writeTranscript(
          home,
          "large",
          session1,
          `${ignored.repeat(9)}${line(user({ uuid: "u1", content: "Retained" }))}`,
        );
        const source = yield* makeClaudeThreadImportSource({
          provider,
          claudeSettings: { homePath: home },
        });
        const loaded = yield* source.load({ ...scope, nativeThreadId: session1 });
        expect(loaded.normalizedHistory).toContainEqual({
          _tag: "Message",
          sequence: 1,
          messageId: "u1",
          role: "user",
          text: "Retained",
        });
      }),
    ),
  );

  it.effect("maps approval, user-input, and result errors while skipping synthetic records", () =>
    withHome((home) =>
      Effect.gen(function* () {
        const transcript = [
          user({ uuid: "u1", content: "Continue" }),
          {
            type: "user",
            sessionId: session1,
            uuid: "synthetic-1",
            parentUuid: "u1",
            cwd: "/work/project/packages/server",
            timestamp: "2026-01-02T03:04:06.000Z",
            isMeta: true,
            message: { role: "user", content: "Synthetic command output" },
          },
          {
            type: "permission_request",
            sessionId: session1,
            uuid: "approval-1",
            parentUuid: "synthetic-1",
            cwd: "/work/project/packages/server",
            timestamp: "2026-01-02T03:04:07.000Z",
            prompt: "Allow shell command?",
            decision: "approved",
          },
          {
            type: "user_input",
            sessionId: session1,
            uuid: "input-1",
            parentUuid: "approval-1",
            cwd: "/work/project/packages/server",
            timestamp: "2026-01-02T03:04:08.000Z",
            prompt: "Which environment?",
            response: "staging",
          },
          {
            type: "result",
            subtype: "error_during_execution",
            sessionId: session1,
            uuid: "result-1",
            parentUuid: "input-1",
            cwd: "/work/project/packages/server",
            timestamp: "2026-01-02T03:04:09.000Z",
            error: "Command failed",
          },
          { type: "summary", summary: "private cache summary", leafUuid: "result-1" },
          { type: "progress", data: { raw: "private cache metadata" } },
        ]
          .map(line)
          .join("");
        yield* writeTranscript(home, "activities", session1, transcript);
        const source = yield* makeClaudeThreadImportSource({
          provider,
          claudeSettings: { homePath: home },
        });

        const loaded = yield* source.load({ ...scope, nativeThreadId: session1 });

        expect(loaded.normalizedHistory).toContainEqual({
          _tag: "Approval",
          sequence: 2,
          activityId: "approval-1",
          prompt: "Allow shell command?",
          decision: "approved",
        });
        expect(loaded.normalizedHistory).toContainEqual({
          _tag: "UserInput",
          sequence: 3,
          activityId: "input-1",
          prompt: "Which environment?",
          response: "staging",
        });
        expect(loaded.normalizedHistory).toContainEqual({
          _tag: "Error",
          sequence: 4,
          activityId: "result-1",
          message: "Command failed",
          code: "error_during_execution",
        });
        expect(loaded.normalizedHistory.at(-1)).toEqual({
          _tag: "TurnLifecycle",
          sequence: 5,
          turnId: "u1",
          phase: "failed",
        });
        expect(JSON.stringify(loaded)).not.toContain("private cache");
      }),
    ),
  );

  it.effect("keeps repeated tool ids and orphan results in chronological order", () =>
    withHome((home) =>
      Effect.gen(function* () {
        const transcript = [
          user({
            uuid: "u0",
            content: [{ type: "tool_result", tool_use_id: "missing", content: "orphan" }],
          }),
          assistant({
            uuid: "a1",
            parentUuid: "u0",
            content: [{ type: "tool_use", id: "same-tool", name: "Read", input: { n: 1 } }],
          }),
          user({
            uuid: "r1",
            parentUuid: "a1",
            content: [{ type: "tool_result", tool_use_id: "same-tool", content: "one" }],
          }),
          assistant({
            uuid: "a2",
            parentUuid: "r1",
            content: [{ type: "tool_use", id: "same-tool", name: "Read", input: { n: 2 } }],
          }),
          user({
            uuid: "r2",
            parentUuid: "a2",
            content: [{ type: "tool_result", tool_use_id: "same-tool", content: "two" }],
          }),
        ]
          .map(line)
          .join("");
        yield* writeTranscript(home, "tools", session1, transcript);
        const source = yield* makeClaudeThreadImportSource({
          provider,
          claudeSettings: { homePath: home },
        });

        const loaded = yield* source.load({ ...scope, nativeThreadId: session1 });
        expect(
          loaded.normalizedHistory.filter(
            (item) => item._tag === "ToolCall" || item._tag === "ToolResult",
          ),
        ).toEqual([
          {
            _tag: "ToolResult",
            sequence: 0,
            callId: orphanId("missing", 1),
            output: "orphan",
            isError: false,
          },
          {
            _tag: "ToolCall",
            sequence: 2,
            callId: callId("same-tool", 1),
            name: "Read",
            input: { n: 1 },
          },
          {
            _tag: "ToolResult",
            sequence: 3,
            callId: callId("same-tool", 1),
            output: "one",
            isError: false,
          },
          {
            _tag: "ToolCall",
            sequence: 4,
            callId: callId("same-tool", 2),
            name: "Read",
            input: { n: 2 },
          },
          {
            _tag: "ToolResult",
            sequence: 5,
            callId: callId("same-tool", 2),
            output: "two",
            isError: false,
          },
        ]);
      }),
    ),
  );

  it.effect("preserves mixed user blocks and keeps adversarial native tool ids disjoint", () =>
    withHome((home) =>
      Effect.gen(function* () {
        const ids = ["x", "x#2", "claude-orphan:eA:1"];
        const transcript = [
          ...ids.map((id, index) =>
            assistant({
              uuid: `a${index}`,
              parentUuid: "u",
              content: [{ type: "tool_use", id, name: "T", input: index }],
            }),
          ),
          user({
            uuid: "mixed",
            content: [
              { type: "text", text: "before" },
              { type: "tool_result", tool_use_id: ids[0], content: "r0" },
              { type: "text", text: "between" },
              { type: "tool_result", tool_use_id: ids[1], content: "r1" },
              { type: "text", text: "after" },
            ],
          }),
        ]
          .map(line)
          .join("");
        yield* writeTranscript(home, "mixed", session1, transcript);
        const source = yield* makeClaudeThreadImportSource({
          provider,
          claudeSettings: { homePath: home },
        });
        const loaded = yield* source.load({ ...scope, nativeThreadId: session1 });
        expect(
          loaded.normalizedHistory
            .filter((item) => item._tag === "Message" || item._tag === "ToolResult")
            .map((item) => (item._tag === "Message" ? item.text : item.output)),
        ).toEqual(["before", "r0", "between", "r1", "after"]);
        const normalizedIds = loaded.normalizedHistory
          .filter((item) => item._tag === "ToolCall")
          .map((item) => item.callId);
        expect(new Set(normalizedIds).size).toBe(ids.length);
      }),
    ),
  );

  it.effect(
    "deduplicates exact and cumulative assistant snapshots without dropping distinct later blocks",
    () =>
      withHome((home) =>
        Effect.gen(function* () {
          const transcript = [
            user({ uuid: "u1", content: "go" }),
            assistant({
              uuid: "same-a",
              parentUuid: "u1",
              content: [
                { type: "text", text: "Hello" },
                { type: "thinking", thinking: "plan" },
                { type: "tool_use", id: "tool", name: "Read", input: {} },
              ],
            }),
            assistant({
              uuid: "same-a",
              parentUuid: "u1",
              content: [
                { type: "text", text: "Hello" },
                { type: "thinking", thinking: "plan" },
                { type: "tool_use", id: "tool", name: "Read", input: {} },
              ],
            }),
            assistant({
              uuid: "same-a",
              parentUuid: "u1",
              content: [
                { type: "text", text: "Hello world" },
                { type: "thinking", thinking: "plan more" },
                { type: "tool_use", id: "tool", name: "Read", input: {} },
                { type: "text", text: "Distinct" },
              ],
            }),
          ]
            .map(line)
            .join("");
          yield* writeTranscript(home, "snapshots", session1, transcript);
          const source = yield* makeClaudeThreadImportSource({
            provider,
            claudeSettings: { homePath: home },
          });
          const loaded = yield* source.load({ ...scope, nativeThreadId: session1 });
          expect(
            loaded.normalizedHistory.flatMap((item) =>
              item._tag === "Message" && item.role === "assistant" ? [item.text] : [],
            ),
          ).toEqual(["Hello", " world", "Distinct"]);
          expect(
            loaded.normalizedHistory
              .filter((item) => item._tag === "Reasoning")
              .map((item) => item.text),
          ).toEqual(["plan", " more"]);
          expect(loaded.normalizedHistory.filter((item) => item._tag === "ToolCall")).toHaveLength(
            1,
          );
        }),
      ),
  );

  it.effect("rejects mismatched closing delimiters at an incomplete final tail", () =>
    withHome((home) =>
      Effect.gen(function* () {
        const source = yield* makeClaudeThreadImportSource({
          provider,
          claudeSettings: { homePath: home },
        });
        for (const [index, tail] of ["{]", "[}", "]"].entries()) {
          yield* writeTranscript(
            home,
            `mismatch-${index}`,
            session1,
            `${line(user({ uuid: "u1", content: "ok" }))}${tail}`,
          );
          expect(
            Exit.isFailure(yield* Effect.exit(source.load({ ...scope, nativeThreadId: session1 }))),
          ).toBe(true);
          yield* Effect.promise(() =>
            NodeFSP.rm(NodePath.join(home, ".claude", "projects", `mismatch-${index}`), {
              recursive: true,
            }),
          );
        }
      }),
    ),
  );

  it.effect("reconciles string and reordered array snapshots by semantic identity", () =>
    withHome((home) =>
      Effect.gen(function* () {
        const transcript = [
          user({ uuid: "u1", content: "go" }),
          assistant({ uuid: "string-a", parentUuid: "u1", content: "Hello" }),
          assistant({ uuid: "string-a", parentUuid: "u1", content: "Hello" }),
          assistant({ uuid: "string-a", parentUuid: "u1", content: "Hello world" }),
          assistant({ uuid: "string-a", parentUuid: "u1", content: "Replacement" }),
          assistant({
            uuid: "array-a",
            parentUuid: "u1",
            content: [
              { type: "text", text: "alpha" },
              { type: "thinking", thinking: "plan" },
            ],
          }),
          assistant({
            uuid: "array-a",
            parentUuid: "u1",
            content: [
              { type: "text", text: "inserted" },
              { type: "thinking", thinking: "plan more" },
              { type: "text", text: "alpha" },
            ],
          }),
          assistant({
            uuid: "array-a",
            parentUuid: "u1",
            content: [
              { type: "text", text: "alpha" },
              { type: "text", text: "inserted" },
              { type: "thinking", thinking: "plan more" },
            ],
          }),
        ]
          .map(line)
          .join("");
        yield* writeTranscript(home, "semantic-snapshots", session1, transcript);
        const source = yield* makeClaudeThreadImportSource({
          provider,
          claudeSettings: { homePath: home },
        });
        const loaded = yield* source.load({ ...scope, nativeThreadId: session1 });
        expect(
          loaded.normalizedHistory.flatMap((item) =>
            item._tag === "Message" && item.role === "assistant" ? [item.text] : [],
          ),
        ).toEqual(["Hello", " world", "Replacement", "alpha", "inserted"]);
        expect(
          loaded.normalizedHistory.flatMap((item) =>
            item._tag === "Reasoning" ? [item.text] : [],
          ),
        ).toEqual(["plan", " more"]);
      }),
    ),
  );

  it.effect("updates a repeated snapshot tool call in place and correlates its result", () =>
    withHome((home) =>
      Effect.gen(function* () {
        const transcript = [
          user({ uuid: "u1", content: "go" }),
          assistant({
            uuid: "tool-snapshot",
            parentUuid: "u1",
            content: [{ type: "tool_use", id: "same", name: "Read", input: { path: "old" } }],
          }),
          assistant({
            uuid: "tool-snapshot",
            parentUuid: "u1",
            content: [
              { type: "text", text: "before tool" },
              { type: "tool_use", id: "same", name: "Read", input: { path: "new", offset: 1 } },
            ],
          }),
          user({
            uuid: "result",
            content: [{ type: "tool_result", tool_use_id: "same", content: "done" }],
          }),
        ]
          .map(line)
          .join("");
        yield* writeTranscript(home, "tool-snapshot", session1, transcript);
        const source = yield* makeClaudeThreadImportSource({
          provider,
          claudeSettings: { homePath: home },
        });
        const loaded = yield* source.load({ ...scope, nativeThreadId: session1 });
        expect(loaded.normalizedHistory.filter((item) => item._tag === "ToolCall")).toEqual([
          {
            _tag: "ToolCall",
            sequence: 2,
            callId: callId("same", 1),
            name: "Read",
            input: { path: "new", offset: 1 },
          },
        ]);
        expect(loaded.normalizedHistory.filter((item) => item._tag === "ToolResult")).toEqual([
          {
            _tag: "ToolResult",
            sequence: 4,
            callId: callId("same", 1),
            output: "done",
            isError: false,
          },
        ]);
      }),
    ),
  );
});
