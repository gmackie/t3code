// @effect-diagnostics nodeBuiltinImport:off - Secret names derive from a synchronous digest.
import * as NodeCrypto from "node:crypto";

import {
  McpOAuthError,
  type McpHttpTransport,
  type McpOAuthServerInput,
  type McpOAuthSignInEvent,
  type McpOAuthSignInInput,
  type McpOAuthStatus,
  type McpOAuthStatusInput,
  type McpOAuthStatusResult,
  type ProjectId,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import {
  auth,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { ServerSettingsService } from "../serverSettings.ts";

/** Where providers send the browser back after sign-in, on whatever origin the client used. */
export const MCP_OAUTH_CALLBACK_PATH = "/oauth/mcp-client/callback";

/** An http server from settings that signs in with OAuth. */
export interface McpOAuthServer {
  readonly name: string;
  readonly transport: McpHttpTransport & { readonly oauth: NonNullable<McpHttpTransport["oauth"]> };
}

export interface McpRemoteAuthShape {
  readonly status: (
    input: McpOAuthStatusInput,
  ) => Effect.Effect<McpOAuthStatusResult, McpOAuthError>;
  /** Streams the authorize URL, then `connected` once the browser comes back. */
  readonly signIn: (
    input: McpOAuthSignInInput,
  ) => Stream.Stream<McpOAuthSignInEvent, McpOAuthError>;
  readonly signOut: (input: McpOAuthServerInput) => Effect.Effect<void, McpOAuthError>;
  /** Finishes a sign-in from the callback's query; returns the server name for the page. */
  readonly complete: (query: URLSearchParams) => Effect.Effect<string, McpOAuthError>;
  /** An enabled OAuth server from the project's effective settings. */
  readonly resolveServer: (
    name: string,
    projectId: ProjectId | null,
  ) => Effect.Effect<McpOAuthServer, McpOAuthError>;
  /** A current access token, refreshed first when it is about to expire. */
  readonly accessToken: (server: McpOAuthServer) => Effect.Effect<string, McpOAuthError>;
  /** Refreshes regardless of expiry, as after the server rejected a token. */
  readonly refresh: (server: McpOAuthServer) => Effect.Effect<string, McpOAuthError>;
}

export class McpRemoteAuth extends Context.Service<McpRemoteAuth, McpRemoteAuthShape>()(
  "t3/mcp/McpRemoteAuth",
) {}

/** One server's sign-in as kept in the secret store. */
interface StoredSignIn {
  readonly server: string;
  readonly url: string;
  tokens?: OAuthTokens;
  expiresAt?: number;
  needsAuth?: boolean;
  /** The redirect URL the tokens were issued for; refresh must present the same client. */
  redirectUrl?: string;
  /** Registered clients by redirect URL, since each origin registers its own. */
  clients: Record<string, OAuthClientInformationMixed>;
  discovery?: OAuthDiscoveryState;
}

interface PendingSignIn {
  readonly server: McpOAuthServer;
  readonly redirectUrl: string;
  readonly codeVerifier: string;
  readonly done: Deferred.Deferred<void, McpOAuthError>;
}

const SIGN_IN_TIMEOUT = Duration.minutes(10);
/** Refresh this long before the stated expiry so a token never dies mid-request. */
const EXPIRY_MARGIN_MS = 60_000;

const secretName = (server: McpOAuthServer) =>
  `mcp-oauth-${NodeCrypto.createHash("sha256")
    .update(`${server.name}\n${server.transport.url}`)
    .digest("hex")
    .slice(0, 32)}`;

const isOAuthServer = (
  name: string,
  transport: McpHttpTransport | { readonly type: "stdio" },
): McpOAuthServer | undefined =>
  transport.type === "http" && transport.oauth !== undefined
    ? { name, transport: { ...transport, oauth: transport.oauth } }
    : undefined;

const describe = (cause: unknown): string =>
  cause instanceof Error && cause.message.length > 0 ? cause.message : String(cause);

export interface McpRemoteAuthOptions {
  /** Replaces global fetch for discovery, registration and token requests. */
  readonly fetch?: FetchLike;
}

export const make = Effect.fn("McpRemoteAuth.make")(function* (options: McpRemoteAuthOptions = {}) {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const settingsService = yield* ServerSettingsService;
  const pending = yield* Ref.make(new Map<string, PendingSignIn>());
  const refreshLock = yield* Semaphore.make(1);
  const fetchFn = options.fetch;

  const fail = (server: string, detail: string) => new McpOAuthError({ server, detail });

  const load = (server: McpOAuthServer) =>
    secrets.get(secretName(server)).pipe(
      Effect.map(
        Option.match({
          onNone: (): StoredSignIn => ({
            server: server.name,
            url: server.transport.url,
            clients: {},
          }),
          onSome: (bytes) => JSON.parse(new TextDecoder().decode(bytes)) as StoredSignIn,
        }),
      ),
      Effect.mapError(() => fail(server.name, "Could not read the stored sign-in.")),
    );

  const save = (server: McpOAuthServer, record: StoredSignIn) =>
    secrets
      .set(secretName(server), new TextEncoder().encode(JSON.stringify(record)))
      .pipe(Effect.mapError(() => fail(server.name, "Could not store the sign-in.")));

  /**
   * The SDK drives discovery, registration, PKCE, exchange and refresh through
   * this provider. It mutates `record` in memory; callers persist it after.
   */
  const makeProvider = (
    server: McpOAuthServer,
    record: StoredSignIn,
    redirectUrl: string,
    now: number,
    hooks: {
      readonly state?: string;
      readonly codeVerifier?: string;
      readonly onAuthorize?: (url: URL, codeVerifier: string) => void;
    },
  ): OAuthClientProvider => {
    let verifier = hooks.codeVerifier ?? "";
    const { scopes, clientId } = server.transport.oauth;
    return {
      get redirectUrl() {
        return redirectUrl;
      },
      get clientMetadata() {
        return {
          client_name: "T3 Code",
          redirect_uris: [redirectUrl],
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
          ...(scopes.length > 0 ? { scope: scopes.join(" ") } : {}),
        };
      },
      ...(hooks.state === undefined ? {} : { state: () => hooks.state as string }),
      clientInformation: () =>
        clientId === undefined ? record.clients[redirectUrl] : { client_id: clientId },
      saveClientInformation: (information) => {
        record.clients[redirectUrl] = information;
      },
      tokens: () => record.tokens,
      saveTokens: (tokens) => {
        record.tokens = tokens;
        record.redirectUrl = redirectUrl;
        record.needsAuth = false;
        if (tokens.expires_in === undefined) delete record.expiresAt;
        else record.expiresAt = now + tokens.expires_in * 1_000;
      },
      redirectToAuthorization: (url) => {
        hooks.onAuthorize?.(url, verifier);
      },
      saveCodeVerifier: (codeVerifier) => {
        verifier = codeVerifier;
      },
      codeVerifier: () => verifier,
      discoveryState: () => record.discovery,
      saveDiscoveryState: (state) => {
        record.discovery = state;
      },
      invalidateCredentials: (scope) => {
        if (scope === "all" || scope === "tokens") delete record.tokens;
        if (scope === "all" || scope === "client") delete record.clients[redirectUrl];
        if (scope === "all" || scope === "discovery") delete record.discovery;
      },
    };
  };

  const runAuth = (
    server: McpOAuthServer,
    provider: OAuthClientProvider,
    authorizationCode?: string,
  ) =>
    Effect.tryPromise({
      try: () =>
        auth(provider, {
          serverUrl: server.transport.url,
          ...(authorizationCode === undefined ? {} : { authorizationCode }),
          ...(server.transport.oauth.scopes.length > 0
            ? { scope: server.transport.oauth.scopes.join(" ") }
            : {}),
          ...(fetchFn === undefined ? {} : { fetchFn }),
        }),
      catch: (cause) => fail(server.name, `Sign-in with ${server.name} failed: ${describe(cause)}`),
    });

  const effectiveServers = (projectId: ProjectId | null) =>
    settingsService.getSettings.pipe(
      Effect.map((settings) => resolveProjectSettings(settings, projectId).settings.mcpServers),
      Effect.mapError(() => fail("", "Could not read settings.")),
    );

  const findServer = (name: string, projectId: ProjectId | null, requireEnabled: boolean) =>
    effectiveServers(projectId).pipe(
      Effect.flatMap((servers) => {
        const config = servers[name];
        const server =
          config === undefined || (requireEnabled && !config.enabled)
            ? undefined
            : isOAuthServer(name, config.transport);
        return server === undefined
          ? Effect.fail(fail(name, `${name} is not an enabled server that signs in with OAuth.`))
          : Effect.succeed(server);
      }),
    );

  const statusOf = (record: StoredSignIn): McpOAuthStatus => {
    if (record.tokens === undefined) return { status: "signed-out" };
    if (record.needsAuth === true) return { status: "needs-auth" };
    return record.expiresAt === undefined
      ? { status: "connected" }
      : { status: "connected", expiresAt: record.expiresAt };
  };

  const status: McpRemoteAuthShape["status"] = Effect.fn("McpRemoteAuth.status")(function* (input) {
    const servers = yield* effectiveServers(input.projectId ?? null);
    const result: Record<string, McpOAuthStatus> = {};
    for (const [name, config] of Object.entries(servers)) {
      const server = isOAuthServer(name, config.transport);
      if (server !== undefined) result[name] = statusOf(yield* load(server));
    }
    return result;
  });

  const redirectUrlFor = (server: string, origin: string) =>
    Effect.try({
      try: () => {
        const url = new URL(origin);
        if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(origin);
        return new URL(MCP_OAUTH_CALLBACK_PATH, url.origin).href;
      },
      catch: () => fail(server, `${origin} is not an http or https origin.`),
    });

  const signIn: McpRemoteAuthShape["signIn"] = (input) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const server = yield* findServer(input.server, input.projectId ?? null, false);
        const redirectUrl = yield* redirectUrlFor(server.name, input.callbackOrigin);
        const state = NodeCrypto.randomBytes(24).toString("base64url");
        const record = yield* load(server);
        let authorizeUrl: URL | undefined;
        let codeVerifier = "";
        const provider = makeProvider(server, record, redirectUrl, yield* Clock.currentTimeMillis, {
          state,
          onAuthorize: (url, verifier) => {
            authorizeUrl = url;
            codeVerifier = verifier;
          },
        });
        // Hide the current token so the SDK opens the browser instead of refreshing,
        // which lets the user switch account; it stays stored until the new one lands.
        const previousTokens = record.tokens;
        delete record.tokens;
        yield* runAuth(server, provider);
        if (previousTokens !== undefined) record.tokens = previousTokens;
        yield* save(server, record);
        if (authorizeUrl === undefined) {
          return yield* fail(server.name, `${server.name} did not return a sign-in page.`);
        }
        const done = yield* Deferred.make<void, McpOAuthError>();
        yield* Ref.update(pending, (map) =>
          new Map(map).set(state, { server, redirectUrl, codeVerifier, done }),
        );
        const forget = Ref.update(pending, (map) => {
          const next = new Map(map);
          next.delete(state);
          return next;
        });
        const connected = Deferred.await(done).pipe(
          Effect.timeoutOrElse({
            duration: SIGN_IN_TIMEOUT,
            orElse: () => Effect.fail(fail(server.name, "The sign-in timed out.")),
          }),
          Effect.as<McpOAuthSignInEvent>({ type: "connected" }),
        );
        const authorize: McpOAuthSignInEvent = {
          type: "authorize",
          authorizationUrl: authorizeUrl.href,
        };
        return Stream.make(authorize).pipe(
          Stream.concat(Stream.fromEffect(connected)),
          Stream.ensuring(forget),
        );
      }),
    );

  const complete: McpRemoteAuthShape["complete"] = Effect.fn("McpRemoteAuth.complete")(
    function* (query) {
      const state = query.get("state") ?? "";
      const entry = (yield* Ref.get(pending)).get(state);
      if (entry === undefined) {
        return yield* fail("", "This sign-in link is no longer active. Start the sign-in again.");
      }
      const { server } = entry;
      const error = query.get("error");
      const code = query.get("code");
      const outcome = yield* Effect.gen(function* () {
        if (error !== null) {
          return yield* fail(
            server.name,
            `${server.name} declined the sign-in: ${query.get("error_description") ?? error}`,
          );
        }
        if (code === null) return yield* fail(server.name, "The sign-in returned no code.");
        const record = yield* load(server);
        const provider = makeProvider(
          server,
          record,
          entry.redirectUrl,
          yield* Clock.currentTimeMillis,
          { codeVerifier: entry.codeVerifier },
        );
        yield* runAuth(server, provider, code);
        yield* save(server, record);
      }).pipe(Effect.exit);
      yield* Deferred.done(entry.done, outcome);
      yield* Ref.update(pending, (map) => {
        const next = new Map(map);
        next.delete(state);
        return next;
      });
      return yield* outcome.pipe(Effect.as(server.name));
    },
  );

  const refreshNow = (server: McpOAuthServer) =>
    refreshLock.withPermits(1)(
      Effect.gen(function* () {
        const record = yield* load(server);
        if (record.tokens === undefined || record.redirectUrl === undefined) {
          return yield* fail(server.name, `Sign in to ${server.name} in Settings → Tools.`);
        }
        let needsBrowser = false;
        const provider = makeProvider(
          server,
          record,
          record.redirectUrl,
          yield* Clock.currentTimeMillis,
          {
            onAuthorize: () => {
              needsBrowser = true;
            },
          },
        );
        const result = yield* runAuth(server, provider).pipe(Effect.option);
        const token = record.tokens?.access_token;
        if (Option.isNone(result) || result.value !== "AUTHORIZED" || needsBrowser || !token) {
          // Keep the old tokens so status reads `needs-auth` rather than signed out.
          const stale = yield* load(server);
          yield* save(server, { ...stale, needsAuth: true });
          return yield* fail(server.name, `${server.name} needs you to sign in again.`);
        }
        yield* save(server, record);
        return token;
      }),
    );

  const accessToken: McpRemoteAuthShape["accessToken"] = Effect.fn("McpRemoteAuth.accessToken")(
    function* (server) {
      const record = yield* load(server);
      const token = record.tokens?.access_token;
      if (token === undefined) {
        return yield* fail(server.name, `Sign in to ${server.name} in Settings → Tools.`);
      }
      if (record.needsAuth === true) {
        return yield* fail(server.name, `${server.name} needs you to sign in again.`);
      }
      const now = yield* Clock.currentTimeMillis;
      if (record.expiresAt === undefined || record.expiresAt - EXPIRY_MARGIN_MS > now) return token;
      return yield* refreshNow(server);
    },
  );

  const signOut: McpRemoteAuthShape["signOut"] = Effect.fn("McpRemoteAuth.signOut")(
    function* (input) {
      const server = yield* findServer(input.server, input.projectId ?? null, false);
      const record = yield* load(server);
      // RFC 8414 lists the revocation endpoint; the SDK's metadata type omits it.
      const metadata = record.discovery?.authorizationServerMetadata;
      const revocation =
        metadata !== undefined && "revocation_endpoint" in metadata
          ? metadata.revocation_endpoint
          : undefined;
      const endpoint = typeof revocation === "string" ? revocation : undefined;
      const client =
        record.redirectUrl === undefined ? undefined : record.clients[record.redirectUrl];
      const token = record.tokens?.refresh_token ?? record.tokens?.access_token;
      if (endpoint !== undefined && token !== undefined && client !== undefined) {
        // Best effort (RFC 7009): the local tokens go either way.
        yield* Effect.tryPromise(() =>
          (fetchFn ?? fetch)(endpoint, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ token, client_id: client.client_id }).toString(),
          }),
        ).pipe(Effect.ignore);
      }
      yield* secrets
        .remove(secretName(server))
        .pipe(Effect.mapError(() => fail(server.name, "Could not remove the stored sign-in.")));
    },
  );

  return McpRemoteAuth.of({
    status,
    signIn,
    signOut,
    complete,
    resolveServer: Effect.fn("McpRemoteAuth.resolveServer")((name, projectId) =>
      findServer(name, projectId, true),
    ),
    accessToken,
    refresh: refreshNow,
  });
});

export const layer = Layer.effect(McpRemoteAuth, make());
