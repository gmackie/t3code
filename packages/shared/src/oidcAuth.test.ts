import { describe, expect, it } from "vite-plus/test";

import { encodeOidcClientState, isAllowedOidcReturnTarget, oidcReturnTarget } from "./oidcAuth.ts";

describe("oidc return targets", () => {
  it("allows the CLI loopback and the gmacko app scheme", () => {
    expect(isAllowedOidcReturnTarget("http://127.0.0.1:34338/callback")).toBe(true);
    expect(isAllowedOidcReturnTarget("http://localhost:5733/oauth/callback")).toBe(true);
    expect(isAllowedOidcReturnTarget("t3code-gmacko://callback")).toBe(true);
  });

  it("rejects public hosts, missing ports, and embedded credentials", () => {
    expect(isAllowedOidcReturnTarget("https://relay.gmacko.com/oauth/callback")).toBe(false);
    expect(isAllowedOidcReturnTarget("http://127.0.0.1/callback")).toBe(false);
    expect(isAllowedOidcReturnTarget("http://user:pass@127.0.0.1:34338/callback")).toBe(false);
    expect(isAllowedOidcReturnTarget("http://127.0.0.1:34338/elsewhere")).toBe(false);
  });

  it("reads only an allowed target out of the client state", () => {
    const state = encodeOidcClientState({
      nonce: "nonce",
      to: "http://127.0.0.1:34338/callback",
    });
    expect(oidcReturnTarget(state)).toBe("http://127.0.0.1:34338/callback");
    expect(
      oidcReturnTarget(
        encodeOidcClientState({ nonce: "nonce", to: "https://evil.example/callback" }),
      ),
    ).toBeNull();
    expect(oidcReturnTarget(encodeOidcClientState({ nonce: "nonce" }))).toBeNull();
    expect(oidcReturnTarget("not-state")).toBeNull();
  });
});
