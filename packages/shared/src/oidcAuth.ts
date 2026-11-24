/**
 * Public PKCE state for a Nathan sign-in.
 *
 * The registered redirect is the relay's HTTPS callback. `to` is a second hop
 * the relay may use: a loopback listener, or the gmacko desktop scheme. The
 * relay refuses anything else so this value cannot become an open redirect.
 */
export interface OidcClientState {
  readonly nonce: string;
  readonly to?: string;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const LOOPBACK_PATHS = new Set(["/callback", "/oauth/callback"]);
const GMACKO_APP_SCHEME = "t3code-gmacko:";

export function encodeOidcClientState(state: OidcClientState): string {
  const payload: { n: string; to?: string } = { n: state.nonce };
  if (state.to) payload.to = state.to;
  return encodeBase64Url(JSON.stringify(payload));
}

/** Loopback or app-scheme target carried in `state`, or null when there is none or it is not allowed. */
export function oidcReturnTarget(state: string): string | null {
  const parsed = decodeOidcClientState(state);
  const target = parsed?.to;
  if (typeof target !== "string" || target.length === 0) return null;
  return isAllowedOidcReturnTarget(target) ? target : null;
}

export function isAllowedOidcReturnTarget(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash) return false;
  if (url.protocol === GMACKO_APP_SCHEME) {
    return (
      url.hostname === "callback" || url.pathname === "/callback" || url.pathname === "//callback"
    );
  }
  if (url.protocol !== "http:") return false;
  if (!LOOPBACK_HOSTS.has(url.hostname)) return false;
  if (!LOOPBACK_PATHS.has(url.pathname)) return false;
  return url.port !== "";
}

function decodeOidcClientState(
  state: string,
): { readonly n?: unknown; readonly to?: unknown } | null {
  try {
    const json = new TextDecoder().decode(decodeBase64Url(state));
    const value: unknown = JSON.parse(json);
    if (typeof value !== "object" || value === null) return null;
    return value as { n?: unknown; to?: unknown };
  } catch {
    return null;
  }
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decodeBase64Url(value: string): Uint8Array {
  const padded =
    value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
