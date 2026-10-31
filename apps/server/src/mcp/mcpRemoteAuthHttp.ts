import { mcpServerVariableRecord } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import {
  HttpClient,
  HttpClientRequest,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/http";

import { renderMcpClientCallbackPage } from "../auth/mcpOAuthHtml.ts";
import * as ProjectionStoreV2 from "../orchestration-v2/ProjectionStore.ts";
import * as McpRemoteAuth from "./McpRemoteAuth.ts";
import * as McpSessionRegistry from "./McpSessionRegistry.ts";

/**
 * Agents reach OAuth servers through `<prefix>/<name>` with their own `/mcp`
 * session token; T3 swaps in the upstream access token. See `proxyOAuthServers`.
 */
export const MCP_SERVER_PROXY_PREFIX = "/mcp/servers";

const PAGE_HEADERS = {
  "cache-control": "no-store",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
  "referrer-policy": "no-referrer",
};

// Routes take their services when built so the layer, not each request, requires them.
export const layerCallbackRoute = Layer.unwrap(
  Effect.gen(function* () {
    const remoteAuth = yield* McpRemoteAuth.McpRemoteAuth;
    return HttpRouter.add(
      "GET",
      McpRemoteAuth.MCP_OAUTH_CALLBACK_PATH,
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const url = HttpServerRequest.toURL(request);
        const query = Option.isSome(url) ? url.value.searchParams : new URLSearchParams();
        return yield* remoteAuth.complete(query).pipe(
          Effect.map((server) =>
            HttpServerResponse.text(
              renderMcpClientCallbackPage(
                `Signed in to ${server}`,
                `Agents in this environment can now use ${server}.`,
              ),
              { contentType: "text/html; charset=utf-8", headers: PAGE_HEADERS },
            ),
          ),
          Effect.catch((error) =>
            Effect.succeed(
              HttpServerResponse.text(renderMcpClientCallbackPage("Sign-in failed", error.detail), {
                status: 400,
                contentType: "text/html; charset=utf-8",
                headers: PAGE_HEADERS,
              }),
            ),
          ),
        );
      }),
    );
  }),
);

const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "content-type",
  "last-event-id",
  "mcp-protocol-version",
  "mcp-session-id",
];
const FORWARDED_RESPONSE_HEADERS = ["cache-control", "content-type", "mcp-session-id"];

const pick = (
  headers: Readonly<Record<string, string | undefined>>,
  names: ReadonlyArray<string>,
) => {
  const picked: Record<string, string> = {};
  for (const name of names) {
    const value = headers[name];
    if (value !== undefined) picked[name] = value;
  }
  return picked;
};

/**
 * Not 401: a provider's MCP client treats 401 as an invitation to start its
 * own OAuth against this origin, which is T3's authorization server, not the
 * upstream one. The message reaches the agent instead.
 */
const unavailable = (detail: string) => HttpServerResponse.text(detail, { status: 503 });

export const layerProxyRoute = Layer.unwrap(
  Effect.gen(function* () {
    const registry = yield* McpSessionRegistry.McpSessionRegistry;
    const projections = yield* ProjectionStoreV2.ProjectionStoreV2;
    const remoteAuth = yield* McpRemoteAuth.McpRemoteAuth;
    const httpClient = yield* HttpClient.HttpClient;
    return HttpRouter.add(
      "*",
      `${MCP_SERVER_PROXY_PREFIX}/*`,
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;

        const bearer = /^Bearer\s+(.+)$/iu.exec(request.headers.authorization ?? "")?.[1] ?? "";
        const scope = yield* registry.resolve(bearer);
        if (scope === undefined) return HttpServerResponse.text("Unauthorized", { status: 401 });

        const url = HttpServerRequest.toURL(request);
        const name = Option.isSome(url)
          ? decodeURIComponent(url.value.pathname.slice(MCP_SERVER_PROXY_PREFIX.length + 1))
          : "";
        const thread = yield* projections.getThread(scope.thread.threadId).pipe(Effect.option);
        if (Option.isNone(thread)) return unavailable("This thread's project could not be found.");
        const server = yield* remoteAuth
          .resolveServer(name, thread.value.projectId)
          .pipe(Effect.option);
        if (Option.isNone(server)) {
          return HttpServerResponse.text(`${name} is not an OAuth server here.`, { status: 404 });
        }

        const body = request.method === "POST" ? yield* request.arrayBuffer : undefined;
        const headers = {
          ...mcpServerVariableRecord(server.value.transport.headers),
          ...pick(request.headers, FORWARDED_REQUEST_HEADERS),
        };
        const send = (token: string) => {
          const base = HttpClientRequest.make(request.method)(server.value.transport.url).pipe(
            HttpClientRequest.setHeaders({ ...headers, authorization: `Bearer ${token}` }),
          );
          return httpClient.execute(
            body === undefined
              ? base
              : HttpClientRequest.bodyUint8Array(
                  base,
                  new Uint8Array(body),
                  headers["content-type"],
                ),
          );
        };

        const token = yield* Effect.result(remoteAuth.accessToken(server.value));
        if (Result.isFailure(token)) return unavailable(token.failure.detail);
        let response = yield* send(token.success);
        if (response.status === 401) {
          // The upstream rejected a token we thought was live: refresh once, then retry.
          const refreshed = yield* Effect.result(remoteAuth.refresh(server.value));
          if (Result.isFailure(refreshed)) return unavailable(refreshed.failure.detail);
          response = yield* send(refreshed.success);
        }
        return HttpServerResponse.stream(response.stream, {
          status: response.status,
          headers: pick(response.headers, FORWARDED_RESPONSE_HEADERS),
        });
      }).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("MCP server proxy request failed", { cause }).pipe(
            Effect.as(
              HttpServerResponse.text("The MCP server could not be reached.", { status: 502 }),
            ),
          ),
        ),
      ),
    );
  }),
);
