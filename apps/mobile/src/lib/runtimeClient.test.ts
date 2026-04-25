import { describe, expect, it, vi } from "vitest";

import { fetchRuntimeSnapshot, issueWsToken } from "./runtimeClient";

describe("runtimeClient", () => {
  it("issues websocket tokens with bearer auth", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ token: "ws-token", expiresAt: "2026-04-25T20:00:00Z" })),
    );

    const result = await issueWsToken({
      httpBaseUrl: "http://100.88.12.4:3773/",
      sessionToken: "session-token",
      fetch: fetchMock as typeof globalThis.fetch,
    });

    expect(result.token).toBe("ws-token");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://100.88.12.4:3773/api/auth/ws-token",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer session-token",
        }),
      }),
    );
  });

  it("loads orchestration snapshots with bearer auth", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            snapshotSequence: 1,
            projects: [],
            threads: [],
            updatedAt: "2026-04-25T20:00:00Z",
          }),
        ),
    );

    const result = await fetchRuntimeSnapshot({
      httpBaseUrl: "http://100.88.12.4:3773/",
      sessionToken: "session-token",
      fetch: fetchMock as typeof globalThis.fetch,
    });

    expect(result.snapshotSequence).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://100.88.12.4:3773/api/orchestration/snapshot",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer session-token",
        }),
      }),
    );
  });
});
