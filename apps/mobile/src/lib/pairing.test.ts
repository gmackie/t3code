import { describe, expect, it, vi } from "vitest";

import { pairEnvironmentFromUrl } from "./pairing";

describe("pairEnvironmentFromUrl", () => {
  it("bootstraps a bearer session from a pairing url", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/.well-known/t3/environment")) {
        return new Response(
          JSON.stringify({
            environmentId: "env_mobile_test",
            label: "Mackbook Pro",
          }),
        );
      }

      return new Response(
        JSON.stringify({
          authenticated: true,
          role: "owner",
          sessionMethod: "bearer-session-token",
          sessionToken: "session-token",
          expiresAt: "2026-04-24T20:00:00Z",
        }),
      );
    });

    const result = await pairEnvironmentFromUrl({
      pairingUrl: "http://100.88.12.4:3773/pair#token=pairing-token",
      fetch: fetchMock as typeof globalThis.fetch,
    });

    expect(result.record.httpBaseUrl).toBe("http://100.88.12.4:3773/");
    expect(result.record.wsBaseUrl).toBe("ws://100.88.12.4:3773/");
    expect(result.record.environmentId).toBe("env_mobile_test");
    expect(result.record.label).toBe("Mackbook Pro");
    expect(result.sessionToken).toBe("session-token");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects non-bearer pairing responses", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/.well-known/t3/environment")) {
        return new Response(
          JSON.stringify({
            environmentId: "env_mobile_test",
            label: "Mackbook Pro",
          }),
        );
      }

      return new Response(
        JSON.stringify({
          authenticated: false,
          role: null,
          sessionMethod: "bearer-session-token",
          sessionToken: null,
          expiresAt: null,
        }),
      );
    });

    await expect(
      pairEnvironmentFromUrl({
        pairingUrl: "http://100.88.12.4:3773/pair#token=pairing-token",
        fetch: fetchMock as typeof globalThis.fetch,
      }),
    ).rejects.toThrow("Pairing did not produce a bearer session.");
  });

  it("does not consume the one-time token when descriptor fetch fails", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/.well-known/t3/environment")) {
        throw new TypeError("Network request failed");
      }

      return new Response(
        JSON.stringify({
          authenticated: true,
          role: "owner",
          sessionMethod: "bearer-session-token",
          sessionToken: "session-token",
          expiresAt: "2026-04-24T20:00:00Z",
        }),
      );
    });

    await expect(
      pairEnvironmentFromUrl({
        pairingUrl: "http://100.88.12.4:3773/pair#token=pairing-token",
        fetch: fetchMock as typeof globalThis.fetch,
      }),
    ).rejects.toThrow(
      "Could not reach http://100.88.12.4:3773/.well-known/t3/environment. Native error: Network request failed",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
