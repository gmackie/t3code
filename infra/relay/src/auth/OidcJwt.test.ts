import { describe, expect, it } from "vite-plus/test";

import { OidcTokenRejected, verifyOidcJwt, type OidcJsonWebKey } from "./OidcJwt.ts";

const issuer = "https://id.gmac.io/api/auth";
const audience = "t3-connect";
const subject = "user-1";

async function signedToken(input?: {
  readonly payload?: Record<string, unknown>;
  readonly alg?: string;
  readonly keyPair?: CryptoKeyPair;
  readonly kid?: string;
}) {
  const keyPair =
    input?.keyPair ??
    (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]));
  const header = encode({ alg: input?.alg ?? "EdDSA", typ: "JWT", kid: input?.kid ?? "key-1" });
  // A fixed epoch stays inside the verifier's 60s skew without reading the wall clock.
  const now = 4_000_000_000;
  const payload = encode({
    iss: issuer,
    aud: audience,
    sub: subject,
    iat: now,
    exp: now + 300,
    ...input?.payload,
  });
  const signingInput = `${header}.${payload}`;
  const signature =
    input?.alg === "none"
      ? ""
      : encodeBytes(
          new Uint8Array(
            await crypto.subtle.sign(
              { name: "Ed25519" },
              keyPair.privateKey,
              new TextEncoder().encode(signingInput),
            ),
          ),
        );
  const jwk = (await crypto.subtle.exportKey("jwk", keyPair.publicKey)) as OidcJsonWebKey;
  return {
    token: `${signingInput}.${signature}`,
    jwk: { ...jwk, kid: input?.kid ?? "key-1", alg: "EdDSA" },
  };
}

describe("verifyOidcJwt", () => {
  it("accepts an EdDSA token for the Nathan issuer and audience", async () => {
    const { token, jwk } = await signedToken();
    await expect(verifyOidcJwt({ token, issuer, audience, keys: [jwk] })).resolves.toMatchObject({
      sub: subject,
      iss: issuer,
      aud: audience,
    });
  });

  it("rejects a Clerk-style algorithm, the wrong issuer, the wrong audience, and a bad signature", async () => {
    const { token, jwk } = await signedToken();
    const other = await signedToken();
    await expect(
      verifyOidcJwt({ token, issuer, audience, keys: [other.jwk] }),
    ).rejects.toMatchObject({
      reason: "bad_signature",
    });
    const mismatched = await signedToken({ kid: "other" });
    await expect(
      verifyOidcJwt({ token, issuer, audience, keys: [mismatched.jwk] }),
    ).rejects.toMatchObject({ reason: "jwks" });
    await expect(
      verifyOidcJwt({
        token,
        issuer: "https://clerk.t3.codes",
        audience,
        keys: [jwk],
      }),
    ).rejects.toMatchObject({ reason: "issuer" });
    await expect(
      verifyOidcJwt({ token, issuer, audience: "other-client", keys: [jwk] }),
    ).rejects.toMatchObject({ reason: "audience" });
    const rs = await signedToken({ alg: "RS256" });
    await expect(
      verifyOidcJwt({ token: rs.token, issuer, audience, keys: [jwk] }),
    ).rejects.toBeInstanceOf(OidcTokenRejected);
  });

  it("rejects a different subject when one is locked", async () => {
    const { token, jwk } = await signedToken();
    await expect(
      verifyOidcJwt({ token, issuer, audience, allowedSubject: "someone-else", keys: [jwk] }),
    ).rejects.toMatchObject({ reason: "subject" });
  });
});

function encode(value: unknown): string {
  return encodeBytes(new TextEncoder().encode(JSON.stringify(value)));
}

function encodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
