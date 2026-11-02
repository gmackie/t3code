// @effect-diagnostics nodeBuiltinImport:off - The http fixture server uses node:http.
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";

import { expect, it } from "@effect/vitest";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ResolvedMcpServer } from "@t3tools/contracts";
import { McpServerName } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as TestClock from "effect/testing/TestClock";

import * as McpClientPool from "./McpClientPool.ts";

const FIXTURE = new URL("./testing/McpClientPool.fixture.mjs", import.meta.url).pathname;

const fixtureServer = (token = "first"): ResolvedMcpServer => ({
  name: McpServerName.make("fixture"),
  transport: {
    type: "stdio",
    command: process.execPath,
    args: [FIXTURE],
    env: [{ name: "FIXTURE_TOKEN", value: token, sensitive: true }],
  },
});

const whoami = (server: ResolvedMcpServer) =>
  Effect.gen(function* () {
    const pool = yield* McpClientPool.McpClientPool;
    const result = yield* pool.callTool(server, { name: "whoami", arguments: {} });
    return result.structuredContent as {
      readonly pid: number;
      readonly token: string | null;
      readonly stateHome: string | null;
      readonly uiExtension: { readonly mimeTypes: ReadonlyArray<string> } | null;
    };
  });

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const withPool = <A, E>(effect: Effect.Effect<A, E, McpClientPool.McpClientPool>) =>
  effect.pipe(Effect.provide(McpClientPool.layerWith({ idleTimeout: "1 minute" })));

it.effect("talks to a stdio server with its secrets and the MCP Apps extension", () =>
  withPool(
    Effect.gen(function* () {
      const pool = yield* McpClientPool.McpClientPool;
      const server = fixtureServer();

      const tools = yield* pool.listTools(server);
      expect(tools.map((tool) => tool.name).toSorted()).toEqual(["crash", "model_only", "whoami"]);

      const facts = yield* whoami(server);
      expect(facts.token).toBe("first");
      expect(facts.uiExtension).toEqual({ mimeTypes: ["text/html;profile=mcp-app"] });

      const resource = yield* pool.readResource(server, "ui://fixture/panel");
      expect(resource.contents).toEqual([
        { uri: "ui://fixture/panel", mimeType: "text/html;profile=mcp-app", text: "<p>panel</p>" },
      ]);
    }),
  ),
);

it.effect("shares the server's environment so pool and session copies can share state", () =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.env.XDG_STATE_HOME;
      process.env.XDG_STATE_HOME = "/tmp/t3-pool-state";
      return previous;
    }),
    () =>
      withPool(
        Effect.gen(function* () {
          const facts = yield* whoami(fixtureServer());
          expect(facts.stateHome).toBe("/tmp/t3-pool-state");
        }),
      ),
    (previous) =>
      Effect.sync(() => {
        if (previous === undefined) delete process.env.XDG_STATE_HOME;
        else process.env.XDG_STATE_HOME = previous;
      }),
  ),
);

it.effect("reuses a connection until the server's config changes", () =>
  withPool(
    Effect.gen(function* () {
      const first = yield* whoami(fixtureServer("first"));
      const again = yield* whoami(fixtureServer("first"));
      const rotated = yield* whoami(fixtureServer("rotated"));

      expect(again.pid).toBe(first.pid);
      expect(rotated.pid).not.toBe(first.pid);
      expect(rotated.token).toBe("rotated");
    }),
  ),
);

it.effect("closes idle connections and reconnects on the next request", () =>
  withPool(
    Effect.gen(function* () {
      const first = yield* whoami(fixtureServer());
      yield* TestClock.adjust("59 seconds");
      const warm = yield* whoami(fixtureServer());
      yield* TestClock.adjust("61 seconds");
      const cold = yield* whoami(fixtureServer());

      expect(warm.pid).toBe(first.pid);
      expect(cold.pid).not.toBe(first.pid);
      expect(isAlive(first.pid)).toBe(false);
    }),
  ),
);

it.effect("closeServer drops the server's connections", () =>
  withPool(
    Effect.gen(function* () {
      const pool = yield* McpClientPool.McpClientPool;
      const first = yield* whoami(fixtureServer());
      yield* pool.closeServer("fixture");
      const next = yield* whoami(fixtureServer());

      expect(next.pid).not.toBe(first.pid);
      expect(isAlive(first.pid)).toBe(false);
    }),
  ),
);

it.effect("reconnects after the server process dies", () =>
  withPool(
    Effect.gen(function* () {
      const pool = yield* McpClientPool.McpClientPool;
      const first = yield* whoami(fixtureServer());
      const crash = yield* Effect.exit(
        pool.callTool(fixtureServer(), { name: "crash", arguments: {} }),
      );
      const next = yield* whoami(fixtureServer());

      expect(Exit.isFailure(crash)).toBe(true);
      expect(next.pid).not.toBe(first.pid);
    }),
  ),
);

it.effect("reports a server that can't start and retries on the next request", () =>
  withPool(
    Effect.gen(function* () {
      const pool = yield* McpClientPool.McpClientPool;
      const broken: ResolvedMcpServer = {
        name: McpServerName.make("broken"),
        transport: { type: "stdio", command: "t3-missing-mcp-server", args: [], env: [] },
      };

      const error = yield* Effect.flip(pool.listTools(broken));
      expect(error).toMatchObject({
        _tag: "McpClientPoolError",
        server: "broken",
        operation: "connect",
      });
      const again = yield* Effect.flip(pool.listTools(broken));
      expect(again).toMatchObject({ _tag: "McpClientPoolError", operation: "connect" });
    }),
  ),
);

// A stateless streamable-HTTP MCP server that only answers `Bearer good-token`.
const bearerServer = Effect.acquireRelease(
  Effect.promise(async () => {
    const http = NodeHttp.createServer((request, response) => {
      if (request.headers.authorization !== "Bearer good-token") {
        response.writeHead(request.url?.startsWith("/mcp") ? 401 : 404).end();
        return;
      }
      const mcp = new McpServer({ name: "http-fixture", version: "1.0.0" });
      mcp.registerTool("whoami", { description: "Process facts" }, async () => ({
        content: [{ type: "text", text: "signed in" }],
      }));
      const transport = new StreamableHTTPServerTransport({});
      response.on("close", () => void transport.close());
      // The SDK's transport classes predate exactOptionalPropertyTypes.
      void mcp
        .connect(transport as Transport)
        .then(() => transport.handleRequest(request, response));
    });
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    return http;
  }),
  (http) => Effect.promise(() => new Promise<void>((resolve) => http.close(() => resolve()))),
).pipe(
  Effect.map((http): ResolvedMcpServer => ({
    name: McpServerName.make("remote"),
    transport: {
      type: "http",
      url: `http://127.0.0.1:${(http.address() as NodeNet.AddressInfo).port}/mcp`,
      headers: [],
    },
  })),
);

const authProvider = (
  accessToken: string | undefined,
  redirects: Array<string>,
): OAuthClientProvider => ({
  redirectUrl: "http://127.0.0.1/oauth/callback",
  clientMetadata: { redirect_uris: ["http://127.0.0.1/oauth/callback"] },
  clientInformation: () => ({ client_id: "t3-code" }),
  tokens: () => (accessToken ? { access_token: accessToken, token_type: "Bearer" } : undefined),
  saveTokens: () => undefined,
  redirectToAuthorization: (url) => void redirects.push(url.pathname),
  saveCodeVerifier: () => undefined,
  codeVerifier: () => "verifier",
});

it.effect("reports an http server that wants a sign-in as needs-auth", () =>
  Effect.gen(function* () {
    const server = yield* bearerServer;
    const error = yield* Effect.flip(
      Effect.gen(function* () {
        const pool = yield* McpClientPool.McpClientPool;
        return yield* pool.listTools(server);
      }).pipe(Effect.provide(McpClientPool.layer)),
    );
    expect(error).toMatchObject({ _tag: "McpServerNeedsAuthError", server: "remote" });
  }),
);

it.effect("signs http requests through the auth provider", () =>
  Effect.gen(function* () {
    const server = yield* bearerServer;
    const redirects: Array<string> = [];
    const signedIn = yield* Effect.gen(function* () {
      const pool = yield* McpClientPool.McpClientPool;
      return yield* pool.callTool(server, { name: "whoami", arguments: {} });
    }).pipe(
      Effect.provide(
        McpClientPool.layerWith({ authProvider: () => authProvider("good-token", redirects) }),
      ),
    );
    expect(signedIn.content).toEqual([{ type: "text", text: "signed in" }]);

    const signedOut = yield* Effect.flip(
      Effect.gen(function* () {
        const pool = yield* McpClientPool.McpClientPool;
        return yield* pool.listTools(server);
      }).pipe(
        Effect.provide(
          McpClientPool.layerWith({ authProvider: () => authProvider(undefined, redirects) }),
        ),
      ),
    );
    expect(signedOut).toMatchObject({ _tag: "McpServerNeedsAuthError", server: "remote" });
    expect(redirects).toEqual(["/authorize"]);
  }),
);
