import * as NodeTest from "node:test";
import * as NodeAssert from "node:assert/strict";
import {
  launchArguments,
  startConflictSession,
  startConflictSessionWithRetry,
} from "./nightly-conflict-session.mjs";

const input = {
  endpoint: "https://mini.example/mcp",
  token: "test-credential",
  projectId: "project-t3",
  laneSha: "a".repeat(40),
  upstreamSha: "b".repeat(40),
  files: ["pnpm-lock.yaml", "apps/server/src/cli/pair.ts"],
  runUrl: "https://forge.example/actions/runs/1",
};

NodeTest.test("conflict launch is idempotent across reruns and isolated from the lane", () => {
  const first = launchArguments(input);
  NodeAssert.equal(
    first.clientRequestId,
    launchArguments({ ...input, runUrl: "rerun" }).clientRequestId,
  );
  NodeAssert.notEqual(
    first.clientRequestId,
    launchArguments({ ...input, upstreamSha: "c".repeat(40) }).clientRequestId,
  );
  NodeAssert.deepEqual(first.workspaceStrategy, {
    type: "worktree",
    baseRef: "forgejo/custom-local",
    startFromOrigin: true,
  });
  for (const value of [input.laneSha, input.upstreamSha, input.runUrl, ...input.files])
    NodeAssert.ok(first.message.includes(value));
});

NodeTest.test(
  "initializes MCP, propagates session and confirms launched thread over SSE",
  async () => {
    const calls = [];
    const result = await startConflictSession(input, async (_url, options) => {
      const request = JSON.parse(options.body);
      calls.push(request);
      NodeAssert.equal(options.headers.Authorization, "Bearer test-credential");
      if (request.method === "initialize")
        return Response.json(
          { jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18" } },
          { headers: { "mcp-session-id": "session-1" } },
        );
      NodeAssert.equal(options.headers["Mcp-Session-Id"], "session-1");
      if (request.method === "notifications/initialized")
        return new Response(null, { status: 202 });
      NodeAssert.equal(request.params.name, "t3_thread_launch");
      return new Response(
        `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 2, result: { content: [{ type: "text", text: JSON.stringify({ threadId: "thread-1", link: "t3://thread/1" }) }] } })}\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    });
    NodeAssert.deepEqual(result, { threadId: "thread-1", link: "t3://thread/1" });
    NodeAssert.deepEqual(
      calls.map((call) => call.method),
      ["initialize", "notifications/initialized", "tools/call"],
    );
  },
);

NodeTest.test(
  "fails visibly on denied access without including credential or response body",
  async () => {
    await NodeAssert.rejects(
      startConflictSession(
        input,
        async () => new Response("private error details", { status: 403 }),
      ),
      /HTTP 403/,
    );
  },
);

NodeTest.test("tool errors and unconfirmed launches cannot report successful handoff", async () => {
  for (const result of [{ isError: true }, { content: [] }]) {
    await NodeAssert.rejects(
      startConflictSession(input, async (_url, options) => {
        const request = JSON.parse(options.body);
        if (!request.id) return new Response(null, { status: 202 });
        return Response.json({
          jsonrpc: "2.0",
          id: request.id,
          result: request.id === 1 ? {} : result,
        });
      }),
    );
  }
});

NodeTest.test("retries a dropped connection but not denied access", async () => {
  let drops = 2;
  const delays = [];
  const result = await startConflictSessionWithRetry(input, {
    sleep: async (ms) => delays.push(ms),
    fetcher: async (_url, options) => {
      const request = JSON.parse(options.body);
      if (request.method === "initialize" && drops-- > 0)
        throw new TypeError("fetch failed", { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } });
      if (!request.id) return new Response(null, { status: 202 });
      return Response.json({
        id: request.id,
        result: request.id === 1 ? {} : { structuredContent: { threadId: "after-retry" } },
      });
    },
  });
  NodeAssert.equal(result.threadId, "after-retry");
  NodeAssert.equal(delays.length, 2);

  let calls = 0;
  await NodeAssert.rejects(
    startConflictSessionWithRetry(input, {
      sleep: async () => {},
      fetcher: async () => {
        calls++;
        return new Response(null, { status: 403 });
      },
    }),
    /HTTP 403/,
  );
  NodeAssert.equal(calls, 1);
});

NodeTest.test(
  "returns after the matching SSE reply without waiting for stream closure",
  async () => {
    let cancelled = false;
    await startConflictSession(input, async (_url, options) => {
      const request = JSON.parse(options.body);
      if (!request.id) return new Response(null, { status: 202 });
      if (request.id === 1) return Response.json({ id: 1, result: {} });
      return new Response(
        new ReadableStream({
          start(controller) {
            const reply = JSON.stringify({
              id: 2,
              result: { structuredContent: { threadId: "stream-thread" } },
            });
            controller.enqueue(new TextEncoder().encode(`data: ${reply}\n\n`));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    });
    NodeAssert.equal(cancelled, true);
  },
);
