// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off -- Synthetic filesystem fixtures exercise Grok's native JSONL boundary.
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

import { makeGrokThreadImportSource } from "./GrokThreadImportSource.ts";

const provider = {
  instanceId: ProviderInstanceId.make("grok_work"),
  driver: ProviderDriverKind.make("grok"),
};
const scope = {
  environmentId: EnvironmentId.make("environment-1"),
  projectId: ProjectId.make("project-1"),
  projectRoot: "/work/project",
};
const session1 = "019f8819-2cd5-7e92-8ead-0069916ce4a0";
const session2 = "029f8819-2cd5-7e92-8ead-0069916ce4a0";
const line = (value: unknown) => `${JSON.stringify(value)}\n`;

const withHome = <A, E, R>(run: (home: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(process.cwd(), ".grok-import-test-"))),
    run,
    (home) => Effect.promise(() => NodeFSP.rm(home, { recursive: true, force: true })),
  );

const writeSession = (home: string, id: string, cwd: string, updated: string, updates: string) =>
  Effect.promise(async () => {
    const directory = NodePath.join(home, "sessions", encodeURIComponent(cwd), id);
    await NodeFSP.mkdir(directory, { recursive: true });
    await NodeFSP.writeFile(
      NodePath.join(directory, "summary.json"),
      JSON.stringify({
        info: { id, cwd },
        generated_title: `Title ${id.slice(0, 4)}`,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: updated,
        num_messages: 4,
        num_chat_messages: 2,
        current_model_id: "grok-build",
      }),
    );
    await NodeFSP.writeFile(NodePath.join(directory, "updates.jsonl"), updates);
    return directory;
  });

it.layer(NodeServices.layer)("GrokThreadImportSource", (it) => {
  it.effect(
    "discovers only summary metadata from the configured home with stable keyset pagination",
    () =>
      withHome((home) =>
        Effect.gen(function* () {
          yield* writeSession(home, session1, "/work/project", "2026-01-02T00:00:00Z", "not-json");
          yield* writeSession(
            home,
            session2,
            "/work/project/sub",
            "2026-01-03T00:00:00Z",
            "not-json",
          );
          let updateReads = 0;
          const source = yield* makeGrokThreadImportSource({
            provider,
            grokSettings: { homePath: home },
            onUpdatesRead: () => updateReads++,
          });
          const first = yield* source.discover({ ...scope, limit: 1 });
          yield* writeSession(
            home,
            "039f8819-2cd5-7e92-8ead-0069916ce4a0",
            "/work/project",
            "2026-01-04T00:00:00Z",
            "",
          );
          const second = yield* source.discover({ ...scope, limit: 1, cursor: first.nextCursor! });
          expect(first.candidates.map((candidate) => candidate.nativeThreadId)).toEqual([session2]);
          expect(second.candidates.map((candidate) => candidate.nativeThreadId)).toEqual([
            session1,
          ]);
          expect(first.candidates[0]?.metadata.title).toBe("Title 029f");
          expect(updateReads).toBe(0);
        }),
      ),
  );

  it.effect(
    "loads representative ACP updates as bounded normalized history without starting Grok",
    () =>
      withHome((home) =>
        Effect.gen(function* () {
          const update = (sessionUpdate: Record<string, unknown>, method = "session/update") =>
            line({
              method,
              params: { sessionId: session1, update: sessionUpdate },
              timestamp: "2026-01-02T00:00:00Z",
            });
          yield* writeSession(
            home,
            session1,
            "/work/project/sub",
            "2026-01-03T00:00:00Z",
            [
              update(
                {
                  sessionUpdate: "hook_execution",
                  event_name: "user_prompt_submit",
                  prompt_id: "prompt-0",
                },
                "_x.ai/session/update",
              ),
              update({
                sessionUpdate: "user_message_chunk",
                content: { type: "text", text: "Fix it" },
                _meta: { promptIndex: 0 },
              }),
              update({
                sessionUpdate: "agent_thought_chunk",
                content: { type: "text", text: "Inspect" },
              }),
              update({
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "Working" },
              }),
              update({
                sessionUpdate: "tool_call",
                toolCallId: "tool-1",
                title: "Read",
                rawInput: { path: "src/a.ts" },
              }),
              update({
                sessionUpdate: "tool_call_update",
                toolCallId: "tool-1",
                status: "in_progress",
              }),
              update({
                sessionUpdate: "tool_call_update",
                toolCallId: "tool-1",
                status: "completed",
                rawOutput: { text: "ok" },
              }),
              update({
                sessionUpdate: "plan",
                entries: [{ content: "Ship", status: "completed" }],
              }),
              update({ sessionUpdate: "future_optional" }),
              update(
                { sessionUpdate: "turn_completed", prompt_id: "prompt-0" },
                "_x.ai/session/update",
              ),
            ].join(""),
          );
          const source = yield* makeGrokThreadImportSource({
            provider,
            grokSettings: { homePath: home },
          });
          const loaded = yield* source.load({ ...scope, nativeThreadId: session1 });
          expect(loaded.resumeCursor).toEqual({ schemaVersion: 1, sessionId: session1 });
          expect(loaded.recordedCwd).toBe("/work/project/sub");
          expect(loaded.normalizedHistory.map((item) => item._tag)).toEqual([
            "TurnLifecycle",
            "Message",
            "Reasoning",
            "Message",
            "ToolCall",
            "ToolResult",
            "Activity",
            "Activity",
            "TurnLifecycle",
          ]);
          expect(loaded.normalizedHistory.find((item) => item._tag === "ToolResult")).toMatchObject(
            { callId: "grok-call:dG9vbC0x:1", output: { text: "ok" }, isError: false },
          );
          expect(loaded.provenance).toMatchObject({
            modelLabel: "grok-build",
            sourceFormat: "grok-updates-jsonl",
            sourceVersion: "1",
          });
        }),
      ),
  );

  it.effect(
    "rejects duplicate ids and malformed complete records but tolerates an incomplete final append",
    () =>
      withHome((home) =>
        Effect.gen(function* () {
          yield* writeSession(
            home,
            session1,
            "/work/project",
            "2026-01-03T00:00:00Z",
            line({
              method: "session/update",
              params: {
                sessionId: session1,
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: { type: "text", text: "ok" },
                },
              },
            }) + '{"method":',
          );
          const source = yield* makeGrokThreadImportSource({
            provider,
            grokSettings: { homePath: home },
          });
          expect(
            (yield* source.load({ ...scope, nativeThreadId: session1 })).normalizedHistory.some(
              (item) => item._tag === "Message",
            ),
          ).toBe(true);
          yield* Effect.promise(() =>
            NodeFSP.writeFile(
              NodePath.join(
                home,
                "sessions",
                encodeURIComponent("/work/project"),
                session1,
                "updates.jsonl",
              ),
              "{}\nnot-json\n",
            ),
          );
          expect(
            Exit.isFailure(yield* Effect.exit(source.load({ ...scope, nativeThreadId: session1 }))),
          ).toBe(true);
          yield* writeSession(home, session1, "/other", "2026-01-04T00:00:00Z", "");
          expect(
            Exit.isFailure(yield* Effect.exit(source.load({ ...scope, nativeThreadId: session1 }))),
          ).toBe(true);
        }),
      ),
  );

  it.effect("accepts extension envelopes, coalesces chunks, and reconstructs prompt turns", () =>
    withHome((home) =>
      Effect.gen(function* () {
        const event = (method: string, value: Record<string, unknown>) =>
          line({ method, params: { sessionId: session1, update: value } });
        yield* writeSession(
          home,
          session1,
          "/work/project",
          "2026-01-03T00:00:00Z",
          [
            event("_x.ai/session/update", {
              sessionUpdate: "hook_execution",
              event_name: "user_prompt_submit",
            }),
            event("session/update", {
              sessionUpdate: "user_message_chunk",
              content: { type: "text", text: "first" },
              _meta: { promptIndex: 0 },
            }),
            ...Array.from({ length: 300 }, () =>
              event("session/update", {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "x" },
              }),
            ),
            event("session/update", {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "🌍" },
            }),
            event("_x.ai/session/update", { sessionUpdate: "turn_completed", prompt_id: "p0" }),
            event("_x.ai/session/update", {
              sessionUpdate: "hook_execution",
              event_name: "user_prompt_submit",
            }),
            event("session/update", {
              sessionUpdate: "user_message_chunk",
              content: { type: "text", text: "second" },
              _meta: { promptIndex: 1 },
            }),
            event("session/update", {
              sessionUpdate: "agent_thought_chunk",
              content: { type: "text", text: "a" },
            }),
            event("session/update", {
              sessionUpdate: "agent_thought_chunk",
              content: { type: "text", text: "b" },
            }),
            line({ method: "x.ai/future/status", params: { sessionId: session1 } }),
          ].join(""),
        );
        const source = yield* makeGrokThreadImportSource({
          provider,
          grokSettings: { homePath: home },
        });
        const loaded = yield* source.load({ ...scope, nativeThreadId: session1 });
        expect(
          loaded.normalizedHistory
            .filter((item) => item._tag === "Message")
            .map((item) => ("text" in item ? item.text : "")),
        ).toEqual(["first", `${"x".repeat(300)}🌍`, "second"]);
        expect(
          loaded.normalizedHistory
            .filter((item) => item._tag === "Reasoning")
            .map((item) => ("text" in item ? item.text : "")),
        ).toEqual(["ab"]);
        expect(
          loaded.normalizedHistory
            .filter((item) => item._tag === "TurnLifecycle")
            .map((item) => ("turnId" in item ? [item.turnId, item.phase] : [])),
        ).toEqual([
          ["grok-prompt:0", "started"],
          ["grok-prompt:0", "completed"],
          ["grok-prompt:1", "started"],
          ["grok-prompt:1", "interrupted"],
        ]);
        expect(
          loaded.normalizedHistory.some(
            (item) =>
              item._tag === "Activity" && item.label === "Grok extension x.ai/future/status",
          ),
        ).toBe(true);
      }),
    ),
  );

  it.effect("rejects copied cwd groups and accepts a trusted slug-hash marker", () =>
    withHome((home) =>
      Effect.gen(function* () {
        yield* writeSession(home, session1, "/work/project", "2026-01-03T00:00:00Z", "");
        const sessions = NodePath.join(home, "sessions");
        yield* Effect.promise(() =>
          NodeFSP.rename(
            NodePath.join(sessions, encodeURIComponent("/work/project")),
            NodePath.join(sessions, "project-deadbeef"),
          ),
        );
        const source = yield* makeGrokThreadImportSource({
          provider,
          grokSettings: { homePath: home },
        });
        expect((yield* source.discover({ ...scope, limit: 10 })).candidates).toHaveLength(0);
        yield* Effect.promise(() =>
          NodeFSP.writeFile(NodePath.join(sessions, "project-deadbeef", ".cwd"), "/work/project\n"),
        );
        expect((yield* source.discover({ ...scope, limit: 10 })).candidates).toHaveLength(1);
      }),
    ),
  );

  it.effect("rejects symlinked and oversized cwd markers", () =>
    withHome((home) =>
      Effect.gen(function* () {
        yield* writeSession(home, session1, "/work/project", "2026-01-03T00:00:00Z", "");
        const sessions = NodePath.join(home, "sessions");
        const group = NodePath.join(sessions, "project-deadbeef");
        yield* Effect.promise(() =>
          NodeFSP.rename(NodePath.join(sessions, encodeURIComponent("/work/project")), group),
        );
        const outside = NodePath.join(home, "outside-cwd");
        yield* Effect.promise(async () => {
          await NodeFSP.writeFile(outside, "/work/project\n");
          await NodeFSP.symlink(outside, NodePath.join(group, ".cwd"));
        });
        const source = yield* makeGrokThreadImportSource({
          provider,
          grokSettings: { homePath: home },
        });
        expect((yield* source.discover({ ...scope, limit: 10 })).candidates).toHaveLength(0);
        yield* Effect.promise(async () => {
          await NodeFSP.unlink(NodePath.join(group, ".cwd"));
          await NodeFSP.writeFile(NodePath.join(group, ".cwd"), `/${"x".repeat(20_000)}`);
        });
        expect((yield* source.discover({ ...scope, limit: 10 })).candidates).toHaveLength(0);
      }),
    ),
  );

  it.effect("rejects conflicting native prompt ids within one logical turn", () =>
    withHome((home) =>
      Effect.gen(function* () {
        const event = (value: Record<string, unknown>) =>
          line({ method: "_x.ai/session/update", params: { sessionId: session1, update: value } });
        yield* writeSession(
          home,
          session1,
          "/work/project",
          "2026-01-03T00:00:00Z",
          [
            line({
              method: "session/update",
              params: {
                sessionId: session1,
                update: {
                  sessionUpdate: "user_message_chunk",
                  content: { type: "text", text: "one" },
                  _meta: { promptIndex: 0 },
                },
              },
            }),
            event({ sessionUpdate: "agent_result", prompt_id: "native-a" }),
            event({ sessionUpdate: "turn_completed", prompt_id: "native-b" }),
          ].join(""),
        );
        const source = yield* makeGrokThreadImportSource({
          provider,
          grokSettings: { homePath: home },
        });
        expect(
          Exit.isFailure(yield* Effect.exit(source.load({ ...scope, nativeThreadId: session1 }))),
        ).toBe(true);
      }),
    ),
  );

  it.effect("applies retention rules to a complete final record without a newline", () =>
    withHome((home) =>
      Effect.gen(function* () {
        const cache = JSON.stringify({
          method: "x.ai/cache/status",
          params: { sessionId: session1 },
        });
        const directory = yield* writeSession(
          home,
          session1,
          "/work/project",
          "2026-01-03T00:00:00Z",
          cache,
        );
        const source = yield* makeGrokThreadImportSource({
          provider,
          grokSettings: { homePath: home },
        });
        expect(
          (yield* source.load({ ...scope, nativeThreadId: session1 })).normalizedHistory,
        ).toEqual([]);
        const relevant = JSON.stringify({
          method: "session/update",
          params: { sessionId: session1, update: { sessionUpdate: "future_optional" } },
        });
        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            NodePath.join(directory, "updates.jsonl"),
            `${Array.from({ length: 20_000 }, () => relevant).join("\n")}\n${relevant}`,
          ),
        );
        expect(
          Exit.isFailure(yield* Effect.exit(source.load({ ...scope, nativeThreadId: session1 }))),
        ).toBe(true);
      }),
    ),
  );

  it.effect("bounds summary descriptor concurrency and rejects invalid UTF-8", () =>
    withHome((home) =>
      Effect.gen(function* () {
        for (let index = 0; index < 20; index++) {
          const id = `${String(index).padStart(8, "0")}-2cd5-7e92-8ead-${String(index).padStart(12, "0")}`;
          yield* writeSession(home, id, `/work/project/${index}`, "2026-01-03T00:00:00Z", "");
        }
        let active = 0,
          maximum = 0;
        const source = yield* makeGrokThreadImportSource({
          provider,
          grokSettings: { homePath: home },
          onSummaryReadStart: () => {
            active++;
            maximum = Math.max(maximum, active);
          },
          onSummaryReadEnd: () => {
            active--;
          },
        });
        expect((yield* source.discover({ ...scope, limit: 100 })).candidates).toHaveLength(20);
        expect(maximum).toBeLessThanOrEqual(8);
        const directory = NodePath.join(
          home,
          "sessions",
          encodeURIComponent("/work/project/0"),
          "00000000-2cd5-7e92-8ead-000000000000",
        );
        yield* Effect.promise(() =>
          NodeFSP.writeFile(NodePath.join(directory, "updates.jsonl"), Buffer.from([0xff, 0x0a])),
        );
        expect(
          Exit.isFailure(
            yield* Effect.exit(
              source.load({ ...scope, nativeThreadId: "00000000-2cd5-7e92-8ead-000000000000" }),
            ),
          ),
        ).toBe(true);
      }),
    ),
  );

  it.effect(
    "rejects a large aggregate of relevant decoded updates while streaming past cache records",
    () =>
      withHome((home) =>
        Effect.gen(function* () {
          const ignored = Array.from({ length: 2_000 }, () =>
            line({
              method: "x.ai/cache/status",
              params: { sessionId: session1, detail: "x".repeat(1_000) },
            }),
          ).join("");
          const relevant = Array.from({ length: 280 }, () =>
            line({
              method: "session/update",
              params: {
                sessionId: session1,
                update: {
                  sessionUpdate: "tool_call_update",
                  toolCallId: "pending",
                  status: "in_progress",
                  rawOutput: "x".repeat(64_000),
                },
              },
            }),
          ).join("");
          const directory = yield* writeSession(
            home,
            session1,
            "/work/project",
            "2026-01-03T00:00:00Z",
            ignored,
          );
          const source = yield* makeGrokThreadImportSource({
            provider,
            grokSettings: { homePath: home },
          });
          expect(
            (yield* source.load({ ...scope, nativeThreadId: session1 })).normalizedHistory,
          ).toEqual([]);
          yield* Effect.promise(() =>
            NodeFSP.writeFile(NodePath.join(directory, "updates.jsonl"), relevant),
          );
          expect(
            Exit.isFailure(yield* Effect.exit(source.load({ ...scope, nativeThreadId: session1 }))),
          ).toBe(true);
        }),
      ),
  );
});
