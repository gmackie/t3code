import type {
  AuthBearerBootstrapResult,
  AuthBootstrapInput,
  AuthBootstrapResult,
  AuthClientMetadata,
  AuthCreatePairingCredentialInput,
  AuthPairingCredentialResult,
  AuthRevokeClientSessionInput,
  AuthRevokePairingLinkInput,
  AuthSessionId,
  AuthSessionState,
  AuthWebSocketTokenResult,
} from "@t3tools/contracts";

import {
  getPairingTokenFromUrl,
  stripPairingTokenFromUrl as stripPairingTokenUrl,
} from "../../pairingUrl";

import { resolvePrimaryEnvironmentHttpUrl } from "./target";
import { Data, Predicate } from "effect";

export class BootstrapHttpError extends Data.TaggedError("BootstrapHttpError")<{
  readonly message: string;
  readonly status: number;
}> {}
const isBootstrapHttpError = (u: unknown): u is BootstrapHttpError =>
  Predicate.isTagged(u, "BootstrapHttpError");
import { readPrimaryEnvironmentTarget } from "./target";

export interface ServerPairingLinkRecord {
  readonly id: string;
  readonly credential: string;
  readonly role: "owner" | "client";
  readonly subject: string;
  readonly label?: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface ServerClientSessionRecord {
  readonly sessionId: AuthSessionId;
  readonly subject: string;
  readonly role: "owner" | "client";
  readonly method: "browser-session-cookie" | "bearer-session-token";
  readonly client: AuthClientMetadata;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly lastConnectedAt: string | null;
  readonly connected: boolean;
  readonly current: boolean;
}

type ServerAuthGateState =
  | { status: "authenticated" }
  | {
      status: "requires-auth";
      auth: AuthSessionState["auth"];
      errorMessage?: string;
    };

let bootstrapPromise: Promise<ServerAuthGateState> | null = null;
let resolvedAuthenticatedGateState: ServerAuthGateState | null = null;
let primaryBearerSessionToken: string | null = null;
const AUTH_SESSION_ESTABLISH_TIMEOUT_MS = 2_000;
const AUTH_SESSION_ESTABLISH_STEP_MS = 100;
const DESKTOP_BEARER_SESSION_STORAGE_KEY = "t3code:desktop-bearer-session-token";

function getSessionStorage(): Storage | null {
  if (typeof window !== "undefined" && typeof window.sessionStorage !== "undefined") {
    return window.sessionStorage;
  }
  return typeof globalThis.sessionStorage !== "undefined" ? globalThis.sessionStorage : null;
}

function readPersistedPrimaryBearerSessionToken(): string | null {
  const storage = getSessionStorage();
  if (!storage) {
    return null;
  }
  const value = storage.getItem(DESKTOP_BEARER_SESSION_STORAGE_KEY);
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function persistPrimaryBearerSessionToken(token: string | null): void {
  const storage = getSessionStorage();
  if (!storage) {
    return;
  }
  if (typeof token === "string" && token.trim().length > 0) {
    storage.setItem(DESKTOP_BEARER_SESSION_STORAGE_KEY, token);
    return;
  }
  storage.removeItem(DESKTOP_BEARER_SESSION_STORAGE_KEY);
}

export function peekPairingTokenFromUrl(): string | null {
  return getPairingTokenFromUrl(new URL(window.location.href));
}

export function stripPairingTokenFromUrl() {
  const url = new URL(window.location.href);
  const next = stripPairingTokenUrl(url);
  if (next.toString() === url.toString()) {
    return;
  }
  window.history.replaceState({}, document.title, next.toString());
}

export function takePairingTokenFromUrl(): string | null {
  const token = peekPairingTokenFromUrl();
  if (!token) {
    return null;
  }
  stripPairingTokenFromUrl();
  return token;
}

function getDesktopBootstrapCredential(): string | null {
  const bootstrap = window.desktopBridge?.getLocalEnvironmentBootstrap();
  return typeof bootstrap?.bootstrapToken === "string" && bootstrap.bootstrapToken.length > 0
    ? bootstrap.bootstrapToken
    : null;
}

function isDesktopManagedPrimaryEnvironment(): boolean {
  return readPrimaryEnvironmentTarget()?.source === "desktop-managed";
}

function createPrimaryAuthHeaders(
  headers?: Record<string, string>,
): Record<string, string> | undefined {
  const bearerToken = (
    primaryBearerSessionToken ?? readPersistedPrimaryBearerSessionToken()
  )?.trim();
  if (!bearerToken && !headers) {
    return undefined;
  }

  return {
    ...(bearerToken ? { authorization: `Bearer ${bearerToken}` } : {}),
    ...headers,
  };
}

function createPrimaryRequestInit(
  init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> },
): RequestInit {
  const headers = createPrimaryAuthHeaders(init.headers);
  return {
    ...init,
    ...(headers ? { headers } : {}),
  };
}

export async function fetchSessionState(): Promise<AuthSessionState> {
  return retryTransientBootstrap(async () => {
    const response = await fetch(
      resolvePrimaryEnvironmentHttpUrl("/api/auth/session"),
      createPrimaryRequestInit({
        credentials: "include",
      }),
    );
    if (!response.ok) {
      throw new BootstrapHttpError({
        message: `Failed to load server auth session state (${response.status}).`,
        status: response.status,
      });
    }

    return (await response.json()) as AuthSessionState;
  });
}

async function readErrorMessage(response: Response, fallbackMessage: string): Promise<string> {
  const text = await response.text();
  return text || fallbackMessage;
}

async function exchangeBootstrapCredential(
  credential: string,
): Promise<AuthBootstrapResult | AuthBearerBootstrapResult> {
  return retryTransientBootstrap(async () => {
    const payload: AuthBootstrapInput = { credential };
    const usesBearerSession = isDesktopManagedPrimaryEnvironment();
    const response = await fetch(
      resolvePrimaryEnvironmentHttpUrl(
        usesBearerSession ? "/api/auth/bootstrap/bearer" : "/api/auth/bootstrap",
      ),
      {
        body: JSON.stringify(payload),
        credentials: "include",
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      },
    );

    if (!response.ok) {
      const message = await response.text();
      throw new BootstrapHttpError({
        message: message || `Failed to bootstrap auth session (${response.status}).`,
        status: response.status,
      });
    }

    const result = (await response.json()) as AuthBootstrapResult | AuthBearerBootstrapResult;
    primaryBearerSessionToken =
      usesBearerSession && "sessionToken" in result && typeof result.sessionToken === "string"
        ? result.sessionToken
        : null;
    persistPrimaryBearerSessionToken(primaryBearerSessionToken);
    return result;
  });
}

async function waitForAuthenticatedSessionAfterBootstrap(): Promise<AuthSessionState> {
  const startedAt = Date.now();

  while (true) {
    const session = await fetchSessionState();
    if (session.authenticated) {
      return session;
    }

    if (Date.now() - startedAt >= AUTH_SESSION_ESTABLISH_TIMEOUT_MS) {
      throw new Error("Timed out waiting for authenticated session after bootstrap.");
    }

    await waitForBootstrapRetry(AUTH_SESSION_ESTABLISH_STEP_MS);
  }
}

const TRANSIENT_BOOTSTRAP_STATUS_CODES = new Set([502, 503, 504]);
const BOOTSTRAP_RETRY_TIMEOUT_MS = 15_000;
const BOOTSTRAP_RETRY_STEP_MS = 500;

export async function retryTransientBootstrap<T>(operation: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (!isTransientBootstrapError(error)) {
        throw error;
      }

      if (Date.now() - startedAt >= BOOTSTRAP_RETRY_TIMEOUT_MS) {
        throw error;
      }

      await waitForBootstrapRetry(BOOTSTRAP_RETRY_STEP_MS);
    }
  }
}

function waitForBootstrapRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function isTransientBootstrapError(error: unknown): boolean {
  if (isBootstrapHttpError(error)) {
    return TRANSIENT_BOOTSTRAP_STATUS_CODES.has(error.status);
  }

  if (error instanceof TypeError) {
    return true;
  }

  return error instanceof DOMException && error.name === "AbortError";
}

async function bootstrapServerAuth(): Promise<ServerAuthGateState> {
  const bootstrapCredential = getDesktopBootstrapCredential();
  const currentSession = await fetchSessionState();
  if (currentSession.authenticated) {
    return { status: "authenticated" };
  }

  if (!bootstrapCredential) {
    return {
      status: "requires-auth",
      auth: currentSession.auth,
    };
  }

  try {
    const bootstrapResult = await exchangeBootstrapCredential(bootstrapCredential);
    if (
      "sessionToken" in bootstrapResult &&
      typeof bootstrapResult.sessionToken === "string" &&
      bootstrapResult.sessionToken.length > 0
    ) {
      return { status: "authenticated" };
    }
    await waitForAuthenticatedSessionAfterBootstrap();
    return { status: "authenticated" };
  } catch (error) {
    return {
      status: "requires-auth",
      auth: currentSession.auth,
      errorMessage: error instanceof Error ? error.message : "Authentication failed.",
    };
  }
}

export async function submitServerAuthCredential(credential: string): Promise<void> {
  const trimmedCredential = credential.trim();
  if (!trimmedCredential) {
    throw new Error("Enter a pairing token to continue.");
  }

  resolvedAuthenticatedGateState = null;
  await exchangeBootstrapCredential(trimmedCredential);
  bootstrapPromise = null;
  stripPairingTokenFromUrl();
}

export async function createServerPairingCredential(
  label?: string,
): Promise<AuthPairingCredentialResult> {
  const trimmedLabel = label?.trim();
  const payload: AuthCreatePairingCredentialInput = trimmedLabel ? { label: trimmedLabel } : {};
  const response = await fetch(
    resolvePrimaryEnvironmentHttpUrl("/api/auth/pairing-token"),
    createPrimaryRequestInit({
      body: JSON.stringify(payload),
      credentials: "include",
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, `Failed to create pairing credential (${response.status}).`),
    );
  }

  return (await response.json()) as AuthPairingCredentialResult;
}

export async function listServerPairingLinks(): Promise<ReadonlyArray<ServerPairingLinkRecord>> {
  const response = await fetch(
    resolvePrimaryEnvironmentHttpUrl("/api/auth/pairing-links"),
    createPrimaryRequestInit({
      credentials: "include",
    }),
  );

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, `Failed to load pairing links (${response.status}).`),
    );
  }

  return (await response.json()) as ReadonlyArray<ServerPairingLinkRecord>;
}

export async function revokeServerPairingLink(id: string): Promise<void> {
  const payload: AuthRevokePairingLinkInput = { id };
  const response = await fetch(
    resolvePrimaryEnvironmentHttpUrl("/api/auth/pairing-links/revoke"),
    createPrimaryRequestInit({
      body: JSON.stringify(payload),
      credentials: "include",
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, `Failed to revoke pairing link (${response.status}).`),
    );
  }
}

export async function listServerClientSessions(): Promise<
  ReadonlyArray<ServerClientSessionRecord>
> {
  const response = await fetch(
    resolvePrimaryEnvironmentHttpUrl("/api/auth/clients"),
    createPrimaryRequestInit({
      credentials: "include",
    }),
  );

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, `Failed to load paired clients (${response.status}).`),
    );
  }

  return (await response.json()) as ReadonlyArray<ServerClientSessionRecord>;
}

export async function revokeServerClientSession(sessionId: AuthSessionId): Promise<void> {
  const payload: AuthRevokeClientSessionInput = { sessionId };
  const response = await fetch(
    resolvePrimaryEnvironmentHttpUrl("/api/auth/clients/revoke"),
    createPrimaryRequestInit({
      body: JSON.stringify(payload),
      credentials: "include",
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    }),
  );

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, `Failed to revoke client session (${response.status}).`),
    );
  }
}

export async function revokeOtherServerClientSessions(): Promise<number> {
  const response = await fetch(
    resolvePrimaryEnvironmentHttpUrl("/api/auth/clients/revoke-others"),
    createPrimaryRequestInit({
      credentials: "include",
      method: "POST",
    }),
  );

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(
        response,
        `Failed to revoke other client sessions (${response.status}).`,
      ),
    );
  }

  const result = (await response.json()) as { revokedCount?: number };
  return result.revokedCount ?? 0;
}

export async function resolvePrimaryWebSocketConnectionUrl(wsBaseUrl: string): Promise<string> {
  if (!primaryBearerSessionToken) {
    return wsBaseUrl;
  }

  const response = await fetch(
    resolvePrimaryEnvironmentHttpUrl("/api/auth/ws-token"),
    createPrimaryRequestInit({
      credentials: "include",
      method: "POST",
    }),
  );

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, `Failed to issue websocket token (${response.status}).`),
    );
  }

  const issued = (await response.json()) as AuthWebSocketTokenResult;
  const url = new URL(wsBaseUrl, window.location.origin);
  url.searchParams.set("wsToken", issued.token);
  return url.toString();
}

export async function resolveInitialServerAuthGateState(): Promise<ServerAuthGateState> {
  if (resolvedAuthenticatedGateState?.status === "authenticated") {
    return resolvedAuthenticatedGateState;
  }

  if (bootstrapPromise) {
    return bootstrapPromise;
  }

  const nextPromise = bootstrapServerAuth();
  bootstrapPromise = nextPromise;
  return nextPromise
    .then((result) => {
      if (result.status === "authenticated") {
        resolvedAuthenticatedGateState = result;
      }
      return result;
    })
    .finally(() => {
      if (bootstrapPromise === nextPromise) {
        bootstrapPromise = null;
      }
    });
}

export function __resetServerAuthBootstrapForTests() {
  bootstrapPromise = null;
  resolvedAuthenticatedGateState = null;
  primaryBearerSessionToken = null;
  resolvedAuthenticatedGateState = null;
}
