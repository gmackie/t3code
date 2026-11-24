// @effect-diagnostics globalDate:off extendsNativeError:off - Workers JWT checks stay a Promise so callers can pass keys without an Effect runtime. Expiry reads the caller clock, and a bad token throws its reason.
export class OidcTokenRejected extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = "OidcTokenRejected";
    this.reason = reason;
  }
}

export interface OidcJsonWebKey extends JsonWebKey {
  readonly kid?: string;
  readonly alg?: string;
  readonly use?: string;
}

export interface VerifiedOidcToken {
  readonly sub: string;
  readonly iss: string;
  readonly aud: string;
}

export async function verifyOidcJwt(input: {
  readonly token: string;
  readonly issuer: string;
  readonly audience: string;
  readonly allowedSubject?: string;
  readonly keys: readonly OidcJsonWebKey[];
  readonly nowEpochMs?: number;
}): Promise<VerifiedOidcToken> {
  const parts = input.token.split(".");
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
    throw new OidcTokenRejected("malformed");
  }
  const header = decodeJsonPart(parts[0]);
  if (header.alg !== "EdDSA") throw new OidcTokenRejected("unexpected_alg");
  const key = selectKey(input.keys, typeof header.kid === "string" ? header.kid : undefined);
  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const signature = decodeBase64Url(parts[2]);
  const cryptoKey = await crypto.subtle.importKey(
    "jwk",
    { ...key, alg: "EdDSA", ext: true },
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify({ name: "Ed25519" }, cryptoKey, signature, data);
  if (!valid) throw new OidcTokenRejected("bad_signature");

  const payload = decodeJsonPart(parts[1]);
  const issuer = normalizeIssuer(input.issuer);
  if (typeof payload.iss !== "string" || normalizeIssuer(payload.iss) !== issuer) {
    throw new OidcTokenRejected("issuer");
  }
  if (!audienceMatches(payload.aud, input.audience)) throw new OidcTokenRejected("audience");
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new OidcTokenRejected("subject");
  }
  if (input.allowedSubject && payload.sub !== input.allowedSubject) {
    throw new OidcTokenRejected("subject");
  }
  const now = Math.floor((input.nowEpochMs ?? Date.now()) / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now - 60)
    throw new OidcTokenRejected("expired");
  if (typeof payload.nbf === "number" && payload.nbf > now + 60)
    throw new OidcTokenRejected("not_yet_valid");
  return { sub: payload.sub, iss: issuer, aud: input.audience };
}

const jwksCache = new Map<
  string,
  { readonly expiresAt: number; readonly keys: readonly OidcJsonWebKey[] }
>();

export async function fetchOidcJwks(
  issuer: string,
  fetchImpl: typeof fetch = fetch,
): Promise<readonly OidcJsonWebKey[]> {
  const normalized = normalizeIssuer(issuer);
  const cached = jwksCache.get(normalized);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.keys;
  const discoveryUrl = new URL(".well-known/openid-configuration", `${normalized}/`);
  const discoveryResponse = await fetchImpl(discoveryUrl);
  if (!discoveryResponse.ok) throw new OidcTokenRejected("discovery");
  const discovery = (await discoveryResponse.json()) as { jwks_uri?: unknown };
  if (typeof discovery.jwks_uri !== "string") throw new OidcTokenRejected("discovery");
  const jwksResponse = await fetchImpl(discovery.jwks_uri);
  if (!jwksResponse.ok) throw new OidcTokenRejected("jwks");
  const body = (await jwksResponse.json()) as { keys?: unknown };
  if (!Array.isArray(body.keys)) throw new OidcTokenRejected("jwks");
  const keys = body.keys.filter(
    (key): key is OidcJsonWebKey => typeof key === "object" && key !== null,
  );
  jwksCache.set(normalized, { expiresAt: now + 5 * 60_000, keys });
  return keys;
}

export function clearOidcJwksCache(): void {
  jwksCache.clear();
}

function selectKey(keys: readonly OidcJsonWebKey[], kid: string | undefined): OidcJsonWebKey {
  const ed25519 = keys.filter(
    (key) => key.kty === "OKP" && key.crv === "Ed25519" && key.use !== "enc",
  );
  const match = kid ? ed25519.filter((key) => key.kid === kid) : ed25519;
  const key = match.length === 1 ? match[0] : undefined;
  if (!key) throw new OidcTokenRejected("jwks");
  return key;
}

function audienceMatches(audience: unknown, expected: string): boolean {
  if (typeof audience === "string") return audience === expected;
  return Array.isArray(audience) && audience.some((entry) => entry === expected);
}

function normalizeIssuer(issuer: string): string {
  return issuer.replace(/\/+$/u, "");
}

function decodeJsonPart(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
    if (typeof parsed !== "object" || parsed === null) throw new OidcTokenRejected("malformed");
    return parsed as Record<string, unknown>;
  } catch (cause) {
    if (cause instanceof OidcTokenRejected) throw cause;
    throw new OidcTokenRejected("malformed");
  }
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded =
    value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
