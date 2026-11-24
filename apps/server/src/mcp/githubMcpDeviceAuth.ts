import { discoverOAuthServerInfo } from "@modelcontextprotocol/sdk/client/auth.js";
import { OAuthTokensSchema } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import { McpOAuthError, type McpOAuthSignInEvent } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { McpOAuthServer } from "./McpRemoteAuth.ts";

const RESOURCE_ORIGIN = "https://api.githubcopilot.com";
const ISSUER = "https://github.com/login/oauth";
const DEVICE_ENDPOINT = "https://github.com/login/device/code";
const VERIFY = "https://github.com/login/device";
const TOKEN_ENDPOINT = "https://github.com/login/oauth/access_token";
const DEVICE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";

export function isGitHubHostedMcp(raw: string) {
  if (!URL.canParse(raw)) return false;
  const url = new URL(raw);
  return (
    url.origin === RESOURCE_ORIGIN &&
    !url.username &&
    !url.password &&
    (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/"))
  );
}

const positiveSeconds = Schema.Int.check(Schema.isGreaterThan(0));
const deviceResponse = Schema.decodeUnknownOption(
  Schema.Struct({
    device_code: Schema.NonEmptyString,
    user_code: Schema.NonEmptyString,
    verification_uri: Schema.Literal(VERIFY),
    interval: Schema.optionalKey(positiveSeconds),
    expires_in: positiveSeconds,
  }),
);
const errorResponse = Schema.decodeUnknownOption(Schema.Struct({ error: Schema.String }));

export const startGitHubDeviceSignIn = Effect.fn("McpRemoteAuth.startGitHubDeviceSignIn")(
  function* (server: McpOAuthServer, fetchFn: FetchLike = fetch) {
    const fail = (detail: string) => new McpOAuthError({ server: server.name, detail });
    const { clientId, scopes } = server.transport.auth;
    if (!clientId)
      return yield* fail(
        "Set the public client ID of a device-enabled GitHub OAuth app in Settings → Tools.",
      );
    const discovery = yield* Effect.tryPromise({
      try: (signal) =>
        discoverOAuthServerInfo(server.transport.url, {
          fetchFn: (url, init) => fetchFn(url, { ...init, signal, redirect: "error" }),
        }),
      catch: () => fail("Could not discover GitHub’s MCP sign-in endpoints."),
    }).pipe(
      Effect.timeoutOrElse({
        duration: "15 seconds",
        orElse: () => Effect.fail(fail("GitHub discovery timed out.")),
      }),
    );
    const metadata = discovery.authorizationServerMetadata;
    const resource = discovery.resourceMetadata?.resource;
    if (
      resource !== new URL(server.transport.url).href ||
      discovery.authorizationServerUrl !== ISSUER ||
      metadata?.issuer !== ISSUER ||
      metadata.token_endpoint !== TOKEN_ENDPOINT ||
      !("device_authorization_endpoint" in metadata) ||
      metadata.device_authorization_endpoint !== DEVICE_ENDPOINT ||
      !metadata.grant_types_supported?.includes(DEVICE_GRANT)
    ) {
      return yield* fail("GitHub did not advertise device authorization for this MCP resource.");
    }

    const post = (endpoint: string, fields: Record<string, string>) =>
      Effect.tryPromise({
        try: async (signal) => {
          const response = await fetchFn(endpoint, {
            method: "POST",
            signal,
            redirect: "error",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({ ...fields, client_id: clientId, resource }).toString(),
          });
          if (response.status === 429 || response.status >= 500) return { retry: true } as const;
          const body: unknown = await response.json();
          return { ok: response.ok, body } as const;
        },
        catch: () => fail("Could not reach GitHub during device authorization."),
      });
    const initial = yield* post(
      DEVICE_ENDPOINT,
      scopes.length ? { scope: scopes.join(" ") } : {},
    ).pipe(
      Effect.timeoutOrElse({
        duration: "15 seconds",
        orElse: () => Effect.fail(fail("GitHub did not issue a device code in time.")),
      }),
    );
    const device = "body" in initial && initial.ok ? deviceResponse(initial.body) : Option.none();
    if (Option.isNone(device))
      return yield* fail(
        "GitHub did not issue a device code. Check the client ID and enable device flow in the GitHub app registration.",
      );
    const code = device.value;
    const expiresAt = (yield* Clock.currentTimeMillis) + code.expires_in * 1000;
    const prompt: McpOAuthSignInEvent = {
      type: "authorize",
      authorizationUrl: code.verification_uri,
      userCode: code.user_code,
    };

    const pollTokens = Effect.gen(function* () {
      let interval = code.interval ?? 5;
      while (true) {
        yield* Effect.sleep(Duration.seconds(interval));
        const answer = yield* post(TOKEN_ENDPOINT, {
          grant_type: DEVICE_GRANT,
          device_code: code.device_code,
        }).pipe(Effect.timeout("15 seconds"), Effect.option);
        if (Option.isNone(answer) || "retry" in answer.value) {
          interval *= 2;
          continue;
        }
        const { body, ok } = answer.value;
        const error = errorResponse(body);
        if (Option.isSome(error)) {
          switch (error.value.error) {
            case "authorization_pending":
              continue;
            case "slow_down":
              interval += 5;
              continue;
            case "access_denied":
              return yield* fail("GitHub declined the sign-in.");
            case "expired_token":
              return yield* fail("The GitHub device code expired. Start sign-in again.");
            default:
              return yield* fail("GitHub refused the device grant. Start sign-in again.");
          }
        }
        const tokens = OAuthTokensSchema.safeParse(body);
        if (
          !ok ||
          !tokens.success ||
          !tokens.data.access_token ||
          tokens.data.token_type.toLowerCase() !== "bearer"
        ) {
          return yield* fail("GitHub returned an invalid device grant.");
        }
        return tokens.data;
      }
    });
    const poll = Effect.gen(function* () {
      const remaining = expiresAt - (yield* Clock.currentTimeMillis);
      const expired = () =>
        Effect.fail(fail("The GitHub device code expired. Start sign-in again."));
      if (remaining <= 0) return yield* expired();
      return yield* pollTokens.pipe(
        Effect.timeoutOrElse({ duration: Duration.millis(remaining), orElse: expired }),
      );
    });
    return { discovery, prompt, poll };
  },
);
