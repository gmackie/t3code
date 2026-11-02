import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { McpOAuthError, ProjectId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse, HttpRouter } from "effect/http";

import * as ProjectionStoreV2 from "../orchestration-v2/ProjectionStore.ts";
import type * as McpInvocationContext from "./McpInvocationContext.ts";
import * as McpRemoteAuth from "./McpRemoteAuth.ts";
import * as McpRemoteAuthHttp from "./mcpRemoteAuthHttp.ts";
import * as McpSessionRegistry from "./McpSessionRegistry.ts";

const SERVER: McpRemoteAuth.McpOAuthServer = {
  name: "linear",
  transport: {
    type: "http",
    url: "https://mcp.example/mcp",
    headers: [{ name: "x-team", value: "core", sensitive: false }],
    auth: { type: "oauth", scopes: [] },
  },
};

interface Upstream {
  readonly requests: Array<{ url: string; headers: Record<string, string>; body: string }>;
  /** Status the upstream returns per access token; 200 when absent. */
  readonly statusFor: Record<string, number>;
}

const makeHandler = (options: { readonly accessToken: Effect.Effect<string, McpOAuthError> }) => {
  const upstream: Upstream = { requests: [], statusFor: {} };
  const refreshes = { count: 0 };
  const layer = McpRemoteAuthHttp.layerProxyRoute.pipe(
    Layer.provide(
      Layer.mock(McpSessionRegistry.McpSessionRegistry)({
        resolve: (token) =>
          Effect.succeed(
            token === "session-token"
              ? ({
                  thread: { threadId: ThreadId.make("thread-1") },
                } as unknown as McpInvocationContext.McpThreadInvocationScope)
              : undefined,
          ),
      }),
    ),
    Layer.provide(
      Layer.mock(ProjectionStoreV2.ProjectionStoreV2)({
        getThread: () =>
          Effect.succeed({
            projectId: ProjectId.make("project-1"),
          } as unknown as Effect.Success<
            ReturnType<ProjectionStoreV2.ProjectionStoreV2["Service"]["getThread"]>
          >),
      }),
    ),
    Layer.provide(
      Layer.mock(McpRemoteAuth.McpRemoteAuth)({
        resolveServer: (name) =>
          name === "linear"
            ? Effect.succeed(SERVER)
            : Effect.fail(new McpOAuthError({ server: name, detail: "unknown" })),
        accessToken: () => options.accessToken,
        refresh: () =>
          Effect.sync(() => {
            refreshes.count += 1;
            return "at-2";
          }),
      }),
    ),
    Layer.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.sync(() => {
            upstream.requests.push({
              url: request.url,
              headers: { ...request.headers },
              body:
                request.body._tag === "Uint8Array"
                  ? new TextDecoder().decode(request.body.body)
                  : "",
            });
            const token = (request.headers.authorization ?? "").replace("Bearer ", "");
            return HttpClientResponse.fromWeb(
              request,
              new Response('{"jsonrpc":"2.0","id":1,"result":{}}', {
                status: upstream.statusFor[token] ?? 200,
                headers: { "content-type": "application/json", "mcp-session-id": "upstream-1" },
              }),
            );
          }),
        ),
      ),
    ),
    Layer.provide(NodeServices.layer),
  );
  const { handler, dispose } = HttpRouter.toWebHandler(layer, { disableLogger: true });
  return { handler, dispose, upstream, refreshes };
};

const call = (
  handler: (request: Request) => Promise<Response>,
  path: string,
  authorization = "Bearer session-token",
) =>
  handler(
    new Request(`http://127.0.0.1:3773${path}`, {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-session-id": "upstream-1",
        cookie: "t3=secret",
      },
      body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
    }),
  );

describe("MCP server proxy", () => {
  it("forwards with the upstream token in place of the session token", async () => {
    const { handler, dispose, upstream } = makeHandler({ accessToken: Effect.succeed("at-1") });
    try {
      const response = await call(handler, "/mcp/servers/linear");
      expect(response.status).toBe(200);
      expect(response.headers.get("mcp-session-id")).toBe("upstream-1");
      expect(await response.text()).toContain('"result"');
      const [forwarded] = upstream.requests;
      expect(forwarded?.url).toBe("https://mcp.example/mcp");
      expect(forwarded?.headers.authorization).toBe("Bearer at-1");
      expect(forwarded?.headers["x-team"]).toBe("core");
      expect(forwarded?.headers["mcp-session-id"]).toBe("upstream-1");
      expect(forwarded?.headers.cookie).toBeUndefined();
      expect(forwarded?.body).toContain("tools/list");
    } finally {
      await dispose();
    }
  });

  it("refreshes once when the upstream rejects the token", async () => {
    const { handler, dispose, upstream, refreshes } = makeHandler({
      accessToken: Effect.succeed("at-1"),
    });
    upstream.statusFor["at-1"] = 401;
    try {
      const response = await call(handler, "/mcp/servers/linear");
      expect(response.status).toBe(200);
      expect(refreshes.count).toBe(1);
      expect(upstream.requests.map((request) => request.headers.authorization)).toEqual([
        "Bearer at-1",
        "Bearer at-2",
      ]);
    } finally {
      await dispose();
    }
  });

  it("refuses a bad session token, an unknown server, and a server that needs sign-in", async () => {
    const needsAuth = makeHandler({
      accessToken: Effect.fail(new McpOAuthError({ server: "linear", detail: "Sign in again." })),
    });
    try {
      expect((await call(needsAuth.handler, "/mcp/servers/linear", "Bearer nope")).status).toBe(
        401,
      );
      expect((await call(needsAuth.handler, "/mcp/servers/github")).status).toBe(404);
      // Not 401: that would send the provider's MCP client into its own OAuth.
      const response = await call(needsAuth.handler, "/mcp/servers/linear");
      expect(response.status).toBe(503);
      expect(await response.text()).toBe("Sign in again.");
      expect(needsAuth.upstream.requests).toEqual([]);
    } finally {
      await needsAuth.dispose();
    }
  });
});
