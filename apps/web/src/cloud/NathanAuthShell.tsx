import { buildConnectClerkAuthorizeUrl, CONNECT_OAUTH_SCOPES } from "@t3tools/shared/connectAuth";
import { encodeOidcClientState, isAllowedOidcReturnTarget } from "@t3tools/shared/oidcAuth";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import {
  activateManagedRelayAuthentication,
  deactivateManagedRelayAuthentication,
} from "./managedRelayAuth";
import { oidcPublicConfig, type OidcPublicConfig } from "./publicConfig";

const VERIFIER_KEY = "t3code.oidc.verifier";
const STATE_KEY = "t3code.oidc.state";
const SESSION_KEY = "t3code.oidc.session";
const EXCHANGED_KEY = "t3code.oidc.exchanged-code";

interface StoredOidcSession {
  readonly idToken: string;
  readonly refreshToken: string;
  readonly sub: string;
  readonly expiresAtEpochMs: number;
}

export interface OidcSessionValue {
  readonly isLoaded: boolean;
  readonly isSignedIn: boolean;
  readonly userId: string | null;
  readonly loadFailed: boolean;
  readonly openAuthPrompt: () => void;
  readonly retrySignIn: () => void;
  readonly signOut: () => void;
  readonly getToken: () => Promise<string | null>;
}

const OidcSessionContext = createContext<OidcSessionValue | null>(null);

export function useOidcSession(): OidcSessionValue {
  const value = useContext(OidcSessionContext);
  if (!value) {
    throw new Error("Nathan sign-in is not mounted.");
  }
  return value;
}

export default function NathanAuthShell({ children }: { readonly children: ReactNode }) {
  const config = oidcPublicConfig();
  const callback = window.location.pathname === "/oauth/callback";
  const [session, setSession] = useState<StoredOidcSession | null>(() =>
    config && !callback ? readStoredSession() : null,
  );
  const [isLoaded, setIsLoaded] = useState(!callback || config === null);
  const [loadFailed, setLoadFailed] = useState(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers a stored Nathan session with the managed relay while this shell is mounted.
  useEffect(() => {
    if (!config || !session || callback) return;
    activateManagedRelayAuthentication(session.sub, () => readRelayToken(config));
  }, [callback, config, session]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- exchanges the Nathan authorization code and registers the relay session.
  useEffect(() => {
    if (!config || !callback) return;
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    if (code && sessionStorage.getItem(EXCHANGED_KEY) === code) {
      const stored = readStoredSession();
      if (stored) {
        activateManagedRelayAuthentication(stored.sub, () => readRelayToken(config));
        window.location.replace("/");
      }
      return;
    }
    if (code) sessionStorage.setItem(EXCHANGED_KEY, code);
    void completeOidcCallback(config, url).then((stored) => {
      if (!stored) {
        if (code) sessionStorage.removeItem(EXCHANGED_KEY);
        setLoadFailed(true);
        setIsLoaded(true);
        return;
      }
      writeStoredSession(stored);
      setSession(stored);
      activateManagedRelayAuthentication(stored.sub, () => readRelayToken(config));
      window.location.replace("/");
    });
  }, [callback, config]);

  const openAuthPrompt = () => {
    if (config) void startOidcSignIn(config);
  };
  const signOut = () => {
    clearOidcStorage();
    deactivateManagedRelayAuthentication();
    setSession(null);
    setLoadFailed(false);
  };
  const value: OidcSessionValue = {
    isLoaded,
    isSignedIn: session !== null,
    userId: session?.sub ?? null,
    loadFailed,
    openAuthPrompt,
    retrySignIn: openAuthPrompt,
    signOut,
    getToken: () => (config ? readRelayToken(config) : Promise.resolve(null)),
  };
  return <OidcSessionContext.Provider value={value}>{children}</OidcSessionContext.Provider>;
}

async function startOidcSignIn(config: OidcPublicConfig): Promise<void> {
  const verifier = base64UrlBytes(crypto.getRandomValues(new Uint8Array(32)));
  const nonce = base64UrlBytes(crypto.getRandomValues(new Uint8Array(16)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64UrlBytes(new Uint8Array(digest));
  const returnTo = `${window.location.origin}/oauth/callback`;
  const state = encodeOidcClientState({
    nonce,
    ...(isAllowedOidcReturnTarget(returnTo) ? { to: returnTo } : {}),
  });
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);
  window.location.assign(
    buildConnectClerkAuthorizeUrl({
      authorizationEndpoint: oidcEndpoint(config.issuer, "oauth2/authorize"),
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      scopes: CONNECT_OAUTH_SCOPES,
      state,
      challenge,
    }),
  );
}

async function completeOidcCallback(
  config: OidcPublicConfig,
  url: URL,
): Promise<StoredOidcSession | null> {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = sessionStorage.getItem(STATE_KEY);
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  if (!code || !state || !expectedState || state !== expectedState || !verifier) return null;
  const response = await fetch(oidcEndpoint(config.issuer, "oauth2/token"), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      code_verifier: verifier,
    }),
  });
  if (!response.ok) return null;
  const stored = await sessionFromTokenResponse(await response.json(), null);
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  return stored;
}

async function readRelayToken(config: OidcPublicConfig): Promise<string | null> {
  const stored = readStoredSession();
  if (!stored) return null;
  if (stored.expiresAtEpochMs - 60_000 > Date.now()) return stored.idToken;
  if (!stored.refreshToken) return stored.idToken;
  const response = await fetch(oidcEndpoint(config.issuer, "oauth2/token"), {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: stored.refreshToken,
      client_id: config.clientId,
    }),
  });
  if (!response.ok) return stored.idToken;
  const refreshed = await sessionFromTokenResponse(await response.json(), stored);
  if (!refreshed) return stored.idToken;
  writeStoredSession(refreshed);
  return refreshed.idToken;
}

async function sessionFromTokenResponse(
  body: unknown,
  previous: StoredOidcSession | null,
): Promise<StoredOidcSession | null> {
  if (typeof body !== "object" || body === null) return null;
  const record = body as {
    id_token?: unknown;
    refresh_token?: unknown;
    expires_in?: unknown;
  };
  const idToken = typeof record.id_token === "string" ? record.id_token : previous?.idToken;
  if (!idToken) return null;
  const sub = jwtSubject(idToken);
  if (!sub) return null;
  const refreshToken =
    typeof record.refresh_token === "string"
      ? record.refresh_token
      : (previous?.refreshToken ?? "");
  const expiresIn = typeof record.expires_in === "number" ? record.expires_in : 3600;
  return { idToken, refreshToken, sub, expiresAtEpochMs: Date.now() + expiresIn * 1000 };
}

function readStoredSession(): StoredOidcSession | null {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const session = parsed as Partial<StoredOidcSession>;
    if (!session.idToken || !session.sub || typeof session.expiresAtEpochMs !== "number")
      return null;
    return {
      idToken: session.idToken,
      refreshToken: session.refreshToken ?? "",
      sub: session.sub,
      expiresAtEpochMs: session.expiresAtEpochMs,
    };
  } catch {
    return null;
  }
}

function writeStoredSession(session: StoredOidcSession): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearOidcStorage(): void {
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(EXCHANGED_KEY);
}

function jwtSubject(token: string): string | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const json: unknown = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload)));
    if (typeof json !== "object" || json === null) return null;
    const sub = (json as { sub?: unknown }).sub;
    return typeof sub === "string" && sub.length > 0 ? sub : null;
  } catch {
    return null;
  }
}

function oidcEndpoint(issuer: string, path: string): string {
  const base = issuer.endsWith("/") ? issuer : `${issuer}/`;
  return new URL(path, base).toString();
}

function base64UrlBytes(bytes: Uint8Array): string {
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
