import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectId, type McpOAuthSignInEvent } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import * as McpRemoteAuth from "./McpRemoteAuth.ts";

const MCP_URL = "https://mcp.example/mcp";
const PROJECT_URL = "https://mcp.example/other";
const ORIGIN = "http://127.0.0.1:3773";
const CALLBACK = `${ORIGIN}${McpRemoteAuth.MCP_OAUTH_CALLBACK_PATH}`;

/** A protected resource plus authorization server, recording what T3 sent. */
const makeProvider = () => {
  const seen = {
    registeredRedirects: [] as string[],
    tokenGrants: [] as URLSearchParams[],
    revoked: [] as string[],
  };
  const control = { refreshFails: false, accessTokenNumber: 0 };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
      return json({
        resource:
          url.origin + url.pathname.replace(/^\/\.well-known\/oauth-protected-resource/u, ""),
        authorization_servers: ["https://auth.example"],
      });
    }
    if (url.href === "https://auth.example/.well-known/oauth-authorization-server") {
      return json({
        issuer: "https://auth.example",
        authorization_endpoint: "https://auth.example/authorize",
        token_endpoint: "https://auth.example/token",
        registration_endpoint: "https://auth.example/register",
        revocation_endpoint: "https://auth.example/revoke",
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
        grant_types_supported: ["authorization_code", "refresh_token"],
      });
    }
    if (url.href === "https://auth.example/register") {
      const metadata = JSON.parse(String(init?.body)) as { redirect_uris: string[] };
      seen.registeredRedirects.push(...metadata.redirect_uris);
      return json({ ...metadata, client_id: "client-1" }, 201);
    }
    if (url.href === "https://auth.example/token") {
      const form = new URLSearchParams(String(init?.body));
      seen.tokenGrants.push(form);
      if (form.get("grant_type") === "authorization_code" && form.get("code") !== "good-code") {
        return json({ error: "invalid_grant" }, 400);
      }
      if (form.get("grant_type") === "refresh_token" && control.refreshFails) {
        return json({ error: "invalid_grant" }, 400);
      }
      control.accessTokenNumber += 1;
      return json({
        access_token: `at-${control.accessTokenNumber}`,
        refresh_token: `rt-${control.accessTokenNumber}`,
        expires_in: 3600,
        token_type: "Bearer",
      });
    }
    if (url.href === "https://auth.example/revoke") {
      seen.revoked.push(new URLSearchParams(String(init?.body)).get("token") ?? "");
      return new Response(null, { status: 200 });
    }
    return new Response("not found", { status: 404 });
  };
  return { fetch, seen, control };
};

const layerMemorySecrets = Layer.sync(ServerSecretStore.ServerSecretStore, () => {
  const values = new Map<string, Uint8Array>();
  return ServerSecretStore.ServerSecretStore.of({
    get: (name) => Effect.sync(() => Option.fromNullishOr(values.get(name))),
    set: (name, value) => Effect.sync(() => void values.set(name, value)),
    create: (name, value) => Effect.sync(() => void values.set(name, value)),
    getOrCreateRandom: () => Effect.succeed(new Uint8Array()),
    remove: (name) => Effect.sync(() => void values.delete(name)),
  });
});

const PROJECT = ProjectId.make("project-1");

const layer = (provider: ReturnType<typeof makeProvider>) =>
  Layer.effect(McpRemoteAuth.McpRemoteAuth, McpRemoteAuth.make({ fetch: provider.fetch })).pipe(
    Layer.provide(layerMemorySecrets),
    Layer.provide(
      ServerSettingsService.layerTest({
        mcpServers: {
          linear: {
            enabled: true,
            transport: { type: "http", url: MCP_URL, headers: [], oauth: { scopes: [] } },
          },
          plain: {
            enabled: true,
            transport: { type: "http", url: "https://plain.example", headers: [] },
          },
        },
        projectSettingsOverrides: {
          [PROJECT]: {
            mcpServers: {
              linear: {
                enabled: true,
                transport: { type: "http", url: PROJECT_URL, headers: [], oauth: { scopes: [] } },
              },
            },
          },
        },
      }),
    ),
  );

/** Starts a sign-in and returns the authorize URL plus the rest of the stream. */
const startSignIn = (projectId?: typeof PROJECT) =>
  Effect.gen(function* () {
    const remoteAuth = yield* McpRemoteAuth.McpRemoteAuth;
    const events = yield* Queue.unbounded<McpOAuthSignInEvent>();
    const fiber = yield* remoteAuth
      .signIn({ server: "linear", callbackOrigin: ORIGIN, ...(projectId ? { projectId } : {}) })
      .pipe(
        Stream.runForEach((event) => Queue.offer(events, event)),
        Effect.forkChild({ startImmediately: true }),
      );
    const first = yield* Queue.take(events);
    assert.equal(first.type, "authorize");
    const authorizationUrl = new URL(first.type === "authorize" ? first.authorizationUrl : "");
    return { authorizationUrl, events, fiber, remoteAuth };
  });

const signedIn = Effect.gen(function* () {
  const { authorizationUrl, events, fiber, remoteAuth } = yield* startSignIn();
  const server = yield* remoteAuth.complete(
    new URLSearchParams({ code: "good-code", state: authorizationUrl.searchParams.get("state")! }),
  );
  assert.equal(server, "linear");
  assert.equal((yield* Queue.take(events)).type, "connected");
  yield* Fiber.join(fiber);
  return remoteAuth;
});

it.effect("signs in with discovery, registration and PKCE, then hands out the token", () => {
  const provider = makeProvider();
  return Effect.gen(function* () {
    const remoteAuth = yield* McpRemoteAuth.McpRemoteAuth;
    assert.deepEqual(yield* remoteAuth.status({}), { linear: { status: "signed-out" } });

    const { authorizationUrl, events, fiber } = yield* startSignIn();
    assert.equal(
      authorizationUrl.origin + authorizationUrl.pathname,
      "https://auth.example/authorize",
    );
    assert.equal(authorizationUrl.searchParams.get("redirect_uri"), CALLBACK);
    assert.equal(authorizationUrl.searchParams.get("client_id"), "client-1");
    assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
    assert.equal(authorizationUrl.searchParams.get("resource"), MCP_URL);
    assert.deepEqual(provider.seen.registeredRedirects, [CALLBACK]);

    yield* remoteAuth.complete(
      new URLSearchParams({
        code: "good-code",
        state: authorizationUrl.searchParams.get("state")!,
      }),
    );
    assert.equal((yield* Queue.take(events)).type, "connected");
    yield* Fiber.join(fiber);

    const exchange = provider.seen.tokenGrants[0]!;
    assert.equal(exchange.get("grant_type"), "authorization_code");
    assert.isAbove(exchange.get("code_verifier")?.length ?? 0, 42);
    assert.deepEqual(yield* remoteAuth.status({}), {
      linear: { status: "connected", expiresAt: 3_600_000 },
    });
    const server = yield* remoteAuth.resolveServer("linear", null);
    assert.equal(yield* remoteAuth.accessToken(server), "at-1");
  }).pipe(Effect.provide(layer(provider)), Effect.provide(NodeServices.layer));
});

it.effect("refreshes near expiry and marks the sign-in needs-auth when refresh is refused", () => {
  const provider = makeProvider();
  return Effect.gen(function* () {
    const remoteAuth = yield* signedIn;
    const server = yield* remoteAuth.resolveServer("linear", null);

    yield* TestClock.adjust("3570 seconds");
    assert.equal(yield* remoteAuth.accessToken(server), "at-2");
    assert.equal(provider.seen.tokenGrants.at(-1)?.get("refresh_token"), "rt-1");

    provider.control.refreshFails = true;
    const refused = yield* Effect.result(remoteAuth.refresh(server));
    assert.isTrue(Result.isFailure(refused));
    assert.deepEqual(yield* remoteAuth.status({}), { linear: { status: "needs-auth" } });
    assert.isTrue(Result.isFailure(yield* Effect.result(remoteAuth.accessToken(server))));
  }).pipe(Effect.provide(layer(provider)), Effect.provide(NodeServices.layer));
});

it.effect(
  "keeps the current sign-in while a new one is abandoned, and signs out with revocation",
  () => {
    const provider = makeProvider();
    return Effect.gen(function* () {
      const remoteAuth = yield* signedIn;
      const { fiber } = yield* startSignIn();
      yield* Fiber.interrupt(fiber);
      assert.equal((yield* remoteAuth.status({})).linear?.status, "connected");

      yield* remoteAuth.signOut({ server: "linear" });
      assert.deepEqual(provider.seen.revoked, ["rt-1"]);
      assert.deepEqual(yield* remoteAuth.status({}), { linear: { status: "signed-out" } });
    }).pipe(Effect.provide(layer(provider)), Effect.provide(NodeServices.layer));
  },
);

it.effect("signs in separately for a project override that points elsewhere", () => {
  const provider = makeProvider();
  return Effect.gen(function* () {
    yield* signedIn;
    const remoteAuth = yield* McpRemoteAuth.McpRemoteAuth;
    assert.deepEqual(yield* remoteAuth.status({ projectId: PROJECT }), {
      linear: { status: "signed-out" },
    });
    const { authorizationUrl, fiber } = yield* startSignIn(PROJECT);
    assert.equal(authorizationUrl.searchParams.get("resource"), PROJECT_URL);
    yield* Fiber.interrupt(fiber);
  }).pipe(Effect.provide(layer(provider)), Effect.provide(NodeServices.layer));
});

it.effect("rejects an unknown state and a declined sign-in without connecting", () => {
  const provider = makeProvider();
  return Effect.gen(function* () {
    const { authorizationUrl, fiber, remoteAuth } = yield* startSignIn();
    const unknown = yield* Effect.result(
      remoteAuth.complete(new URLSearchParams({ state: "nope" })),
    );
    assert.isTrue(Result.isFailure(unknown));

    const declined = yield* Effect.result(
      remoteAuth.complete(
        new URLSearchParams({
          state: authorizationUrl.searchParams.get("state")!,
          error: "access_denied",
        }),
      ),
    );
    assert.isTrue(Result.isFailure(declined));
    assert.isTrue(Result.isFailure(yield* Effect.result(Fiber.join(fiber))));
    assert.deepEqual(yield* remoteAuth.status({}), { linear: { status: "signed-out" } });
  }).pipe(Effect.provide(layer(provider)), Effect.provide(NodeServices.layer));
});
