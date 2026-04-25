import { describe, expect, it, vi } from "vitest";

import {
  approveThreadRequest,
  createThreadPullRequest,
  interruptThreadTurn,
  sendThreadPrompt,
  stopThreadSession,
} from "./threadActions";

function readRequestBody(fetchMock: ReturnType<typeof vi.fn>, index = 0): unknown {
  const init = fetchMock.mock.calls[index]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body));
}

describe("threadActions", () => {
  it("dispatches a prompt reply to the orchestration endpoint", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    await sendThreadPrompt({
      httpBaseUrl: "http://100.88.12.4:3773",
      sessionToken: "session-token",
      threadId: "thread-1",
      text: "Continue with the safer refactor.",
      fetch: fetchMock as typeof globalThis.fetch,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://100.88.12.4:3773/api/orchestration/dispatch",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer session-token",
        }),
      }),
    );
    const body = readRequestBody(fetchMock);
    expect(body).toMatchObject({
      type: "thread.turn.start",
      threadId: "thread-1",
      message: {
        role: "user",
        text: "Continue with the safer refactor.",
      },
    });
  });

  it("dispatches approval decisions", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    await approveThreadRequest({
      httpBaseUrl: "http://100.88.12.4:3773",
      sessionToken: "session-token",
      threadId: "thread-1",
      requestId: "approval-1",
      decision: "accept",
      fetch: fetchMock as typeof globalThis.fetch,
    });

    const body = readRequestBody(fetchMock);
    expect(body).toMatchObject({
      type: "thread.approval.respond",
      threadId: "thread-1",
      requestId: "approval-1",
      decision: "accept",
    });
  });

  it("dispatches recovery controls", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    await interruptThreadTurn({
      httpBaseUrl: "http://100.88.12.4:3773",
      sessionToken: "session-token",
      threadId: "thread-1",
      fetch: fetchMock as typeof globalThis.fetch,
    });
    await stopThreadSession({
      httpBaseUrl: "http://100.88.12.4:3773",
      sessionToken: "session-token",
      threadId: "thread-1",
      fetch: fetchMock as typeof globalThis.fetch,
    });

    const firstBody = readRequestBody(fetchMock) as { readonly type?: string };
    const secondBody = readRequestBody(fetchMock, 1) as { readonly type?: string };
    expect(firstBody.type).toBe("thread.turn.interrupt");
    expect(secondBody.type).toBe("thread.session.stop");
  });

  it("runs the stacked commit push PR action for a thread workspace", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    await createThreadPullRequest({
      httpBaseUrl: "http://100.88.12.4:3773",
      sessionToken: "session-token",
      cwd: "/repo/worktrees/t3code/mobile-control",
      fetch: fetchMock as typeof globalThis.fetch,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://100.88.12.4:3773/api/git/run-stacked-action",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer session-token",
        }),
      }),
    );
    expect(readRequestBody(fetchMock)).toMatchObject({
      cwd: "/repo/worktrees/t3code/mobile-control",
      action: "commit_push_pr",
    });
  });
});
