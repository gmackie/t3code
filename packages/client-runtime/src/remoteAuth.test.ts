import { describe, expect, it } from "vitest";

import {
  createBearerHeaders,
  getPairingTokenFromUrl,
  parsePairingUrl,
  resolvePairingTarget,
} from "./remoteAuth.ts";

describe("remoteAuth", () => {
  it("extracts the bootstrap credential from a pairing url hash", () => {
    const parsed = parsePairingUrl("http://100.88.12.4:3773/pair#token=pairing-token");

    expect(parsed.httpBaseUrl).toBe("http://100.88.12.4:3773/");
    expect(parsed.credential).toBe("pairing-token");
  });

  it("falls back to query-string pairing tokens", () => {
    const parsed = parsePairingUrl("https://remote.example.com/pair?token=pairing-token");

    expect(parsed.httpBaseUrl).toBe("https://remote.example.com/");
    expect(parsed.credential).toBe("pairing-token");
  });

  it("prefers the hash token over the query token when both are present", () => {
    expect(
      getPairingTokenFromUrl(
        new URL("https://remote.example.com/pair?token=query-token#token=hash-token"),
      ),
    ).toBe("hash-token");
  });

  it("resolves both http and ws targets from a pairing url", () => {
    expect(resolvePairingTarget("https://remote.example.com/pair#token=pairing-token")).toEqual({
      credential: "pairing-token",
      httpBaseUrl: "https://remote.example.com/",
      wsBaseUrl: "wss://remote.example.com/",
    });
  });

  it("creates bearer auth headers from a stored session token", () => {
    expect(createBearerHeaders("session-token")).toEqual({
      Authorization: "Bearer session-token",
    });
  });

  it("rejects pairing urls that do not include a token", () => {
    expect(() => parsePairingUrl("https://remote.example.com/pair")).toThrow(
      "Pairing URL is missing its token.",
    );
  });

  it("rejects empty session tokens", () => {
    expect(() => createBearerHeaders("   ")).toThrow("Session token is required.");
  });
});
