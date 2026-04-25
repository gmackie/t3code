import { httpToWsBaseUrl, wsToHttpBaseUrl, type SessionTarget } from "./sessionTarget.ts";

const PAIRING_TOKEN_PARAM = "token";

export interface ParsedPairingUrl {
  readonly httpBaseUrl: string;
  readonly credential: string;
}

export interface ParsedPairingTarget extends ParsedPairingUrl, SessionTarget {}

function readHashParams(url: URL): URLSearchParams {
  return new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
}

export function getPairingTokenFromUrl(url: URL): string | null {
  const hashToken = readHashParams(url).get(PAIRING_TOKEN_PARAM)?.trim() ?? "";
  if (hashToken.length > 0) {
    return hashToken;
  }

  const searchToken = url.searchParams.get(PAIRING_TOKEN_PARAM)?.trim() ?? "";
  return searchToken.length > 0 ? searchToken : null;
}

export function parsePairingUrl(
  value: string,
  options?: { readonly baseUrl?: string },
): ParsedPairingUrl {
  const url = new URL(value, options?.baseUrl);
  const credential = getPairingTokenFromUrl(url) ?? "";
  if (!credential) {
    throw new Error("Pairing URL is missing its token.");
  }

  url.pathname = "/";
  url.search = "";
  url.hash = "";

  return {
    httpBaseUrl: wsToHttpBaseUrl(url.toString()),
    credential,
  };
}

export function resolvePairingTarget(
  value: string,
  options?: { readonly baseUrl?: string },
): ParsedPairingTarget {
  const parsed = parsePairingUrl(value, options);
  return {
    ...parsed,
    wsBaseUrl: httpToWsBaseUrl(parsed.httpBaseUrl, options),
  };
}

export function createBearerHeaders(token: string): Record<string, string> {
  const trimmedToken = token.trim();
  if (!trimmedToken) {
    throw new Error("Session token is required.");
  }

  return {
    Authorization: `Bearer ${trimmedToken}`,
  };
}
