import * as Cloudflare from "@alchemy.run/cloudflare";
import type { RuntimeContext } from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import RelayEnvironment, {
  type RelayEnvironmentDiagnostics,
  relayConnectionRoleHeader,
  relayConnectorTicketHeader,
  relayConnectorTokenHeader,
  relayPublicUrlHeader,
} from "./RelayEnvironment.ts";
import { relayCreatesEdgeWildcardDns } from "../deploymentConfig.ts";
import { ManagedEndpointZone, RelayDeploymentConfig } from "../zone.ts";
import { relayEdgeRouteSuffix, resolveRelayEdgeRoute } from "./routing.ts";

export type EdgeShape = {
  readonly configureEndpoint: (
    endpointKey: string,
    connectorToken: string,
    connectorLeaseId: string,
  ) => Effect.Effect<void, never, RuntimeContext>;
  readonly revokeEndpoint: (
    endpointKey: string,
    connectorLeaseId?: string,
  ) => Effect.Effect<boolean, never, RuntimeContext>;
  readonly diagnosticsEndpoint: (
    endpointKey: string,
  ) => Effect.Effect<RelayEnvironmentDiagnostics, never, RuntimeContext>;
};

export const makeRelayEdgeRuntime = Effect.fn("relay.edge.make_runtime")(function* (
  resolveRoute: (
    url: URL,
  ) => { readonly kind: "connector" | "public"; readonly endpointKey: string } | null,
) {
  const environments = yield* RelayEnvironment;

  return {
    configureEndpoint: (endpointKey: string, connectorToken: string, connectorLeaseId: string) =>
      environments
        .getByName(endpointKey)
        .setConnectorConfiguration(connectorToken, connectorLeaseId),
    revokeEndpoint: (endpointKey: string, connectorLeaseId?: string) =>
      environments.getByName(endpointKey).revokeConnector(connectorLeaseId),
    diagnosticsEndpoint: (endpointKey: string) => environments.getByName(endpointKey).diagnostics(),
    fetch: Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const source = request.source;
      if (!(source instanceof Request)) {
        return HttpServerResponse.text("Unsupported relay request", { status: 500 });
      }

      const url = new URL(source.url);
      const route = resolveRoute(url);
      if (route === null) {
        return HttpServerResponse.text("Unknown relay endpoint", { status: 404 });
      }
      const headers = new Headers(source.headers);
      headers.delete(relayConnectionRoleHeader);
      headers.delete(relayConnectorTicketHeader);
      headers.delete(relayConnectorTokenHeader);
      headers.delete(relayPublicUrlHeader);
      const isWebSocket = request.headers.upgrade?.toLowerCase() === "websocket";
      if (route.kind === "connector") {
        if (isWebSocket) {
          const connectorTicket = url.searchParams.get("ticket");
          if (!connectorTicket) {
            return HttpServerResponse.text("Missing connector ticket", { status: 401 });
          }
          headers.set(relayConnectionRoleHeader, "connector");
          headers.set(relayConnectorTicketHeader, connectorTicket);
          url.searchParams.delete("ticket");
        } else if (request.method === "POST") {
          const authorization = headers.get("authorization");
          if (!authorization?.startsWith("Bearer ")) {
            return HttpServerResponse.text("Missing connector authorization", { status: 401 });
          }
          headers.set(relayConnectionRoleHeader, "connector_ticket");
          headers.set(relayConnectorTokenHeader, authorization.slice("Bearer ".length));
          headers.delete("authorization");
        } else {
          return HttpServerResponse.text("Expected connector ticket request", { status: 405 });
        }
      } else {
        headers.set(relayPublicUrlHeader, url.href);
        headers.set(relayConnectionRoleHeader, isWebSocket ? "client" : "http");
      }

      const forwarded = HttpServerRequest.fromWeb(
        new Request(url, {
          method: source.method,
          headers,
          ...(source.method === "GET" || source.method === "HEAD" || source.body === null
            ? {}
            : { body: source.body }),
        }),
      );
      return yield* environments.getByName(route.endpointKey).fetch(forwarded);
    }),
  };
});

export class Edge extends Cloudflare.Worker<Edge, EdgeShape>()("RelayEdge") {}

export const EdgeLive = Edge.make(
  Effect.gen(function* () {
    const { stage, managedEndpointZoneName } = yield* RelayDeploymentConfig;
    // Props run before the Worker installs RuntimeContext, so a yielded zone
    // id cannot resolve. The zone name is already a string; yielding the zone
    // resource still orders route creation after the zone exists.
    yield* ManagedEndpointZone;
    const edgeRouteSuffix = relayEdgeRouteSuffix(stage, managedEndpointZoneName);
    return {
      main: import.meta.filename,
      compatibility: {
        date: "2026-05-22",
        flags: ["nodejs_compat"],
      },
      routes: [{ pattern: `*-${edgeRouteSuffix}/*`, zoneName: managedEndpointZoneName }],
    };
  }).pipe(Effect.orDie),
  Effect.gen(function* () {
    const { stage, managedEndpointZoneName } = yield* RelayDeploymentConfig;
    const edgeRouteSuffix = relayEdgeRouteSuffix(stage, managedEndpointZoneName);
    const zone = yield* ManagedEndpointZone;

    // Upstream prod creates `*.<zone>` AAAA 100:: so Worker routes resolve.
    // A shared zone that already has that name (gmacko.com's wildcard CNAME)
    // sets RELAY_EDGE_WILDCARD_DNS=false. Replacing the record would retarget
    // every unmatched subdomain.
    const wildcardDns = yield* Config.Boolean("RELAY_EDGE_WILDCARD_DNS").pipe(
      Config.withDefault(true),
    );
    if (relayCreatesEdgeWildcardDns(stage, wildcardDns)) {
      yield* Cloudflare.DNS.Record("RelayEdgeWildcardDns", {
        zoneId: zone.zoneId,
        name: `*.${managedEndpointZoneName}`,
        type: "AAAA",
        content: "100::",
        proxied: true,
      });
    }

    return yield* makeRelayEdgeRuntime((url) =>
      resolveRelayEdgeRoute({
        hostname: url.hostname,
        pathname: url.pathname,
        edgeRouteSuffix,
      }),
    );
  }),
);

export default EdgeLive;
