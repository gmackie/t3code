import { EnvironmentId, KiCadProjectManifest, KiCadViewerSession } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";
import { Atom } from "effect/unstable/reactivity";
import type { PreparedConnection } from "../connection/model.ts";
import { EnvironmentRegistry } from "../connection/registry.ts";
import { environmentEndpointUrl } from "../environment/endpoint.ts";
import { ManagedRelayDpopSigner } from "../relay/managedRelay.ts";
import { executeEnvironmentHttpRequest } from "../rpc/http.ts";
import { createEnvironmentSessionAtoms } from "./session.ts";

export type KiCadQueryTarget = { readonly environmentId: EnvironmentId; readonly cwd: string };

const kiCadEndpointUrl = (base: string, path: string, cwd: string): string => {
  const url = new URL(environmentEndpointUrl(base, `/api/kicad/${path}`));
  url.searchParams.set("cwd", cwd);
  return url.toString();
};

export class KiCadRequestError extends Schema.TaggedError<KiCadRequestError>()(
  "KiCadRequestError",
  {
    message: Schema.String,
  },
) {}

export const fetchKiCadJson = Effect.fn("clientRuntime.fetchKiCadJson")(function* <A>(input: {
  prepared: PreparedConnection;
  cwd: string;
  path: string;
  schema: Schema.Codec<A, unknown>;
  method: "GET" | "POST";
  signer?: Option.Option<ManagedRelayDpopSigner["Service"]>;
}) {
  const signer =
    input.signer !== undefined ? input.signer : yield* Effect.serviceOption(ManagedRelayDpopSigner);
  const url = kiCadEndpointUrl(input.prepared.httpBaseUrl, input.path, input.cwd);
  const authorization = input.prepared.httpAuthorization;
  const client = yield* HttpClient.HttpClient;
  let request = HttpClientRequest.make(input.method)(url);
  if (authorization?._tag === "Bearer") {
    request = HttpClientRequest.setHeader(
      request,
      "authorization",
      `Bearer ${authorization.token}`,
    );
  } else if (authorization?._tag === "Dpop") {
    if (Option.isNone(signer)) {
      return yield* new KiCadRequestError({
        message: "No DPoP signer is available to authorize the CAD request.",
      });
    }
    const proof = yield* signer.value
      .createProof({
        method: input.method,
        url,
        accessToken: authorization.accessToken,
      })
      .pipe(Effect.mapError((cause) => new KiCadRequestError({ message: String(cause) })));
    request = HttpClientRequest.setHeader(
      request,
      "authorization",
      `DPoP ${authorization.accessToken}`,
    );
    request = HttpClientRequest.setHeader(request, "dpop", proof);
  }
  const execute = client.execute(request);
  const withCredentials =
    authorization === null
      ? execute.pipe(Effect.provideService(FetchHttpClient.RequestInit, { credentials: "include" }))
      : execute;
  const response = yield* executeEnvironmentHttpRequest(url, 15_000, withCredentials).pipe(
    Effect.mapError((error) => new KiCadRequestError({ message: String(error) })),
  );
  if (response.status < 200 || response.status >= 300) {
    return yield* new KiCadRequestError({
      message:
        response.status === 404
          ? "This environment does not support CAD mode. Update its T3 Code server to a version with CAD support."
          : response.status === 401 || response.status === 403
            ? "Reconnect to this environment to open CAD mode."
            : `Unable to open CAD mode (server status ${response.status}). Check that the workspace is available.`,
    });
  }
  return yield* response.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(input.schema)));
});

export function createKiCadState<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | HttpClient.HttpClient | R, E>,
) {
  const session = createEnvironmentSessionAtoms(runtime);
  const preparedFor = session.preparedConnectionValueAtom;
  const query = <A>(
    label: string,
    path: string,
    schema: Schema.Codec<A, unknown>,
    method: "GET" | "POST",
  ) => {
    const family = Atom.family((key: string) => {
      const target = JSON.parse(key) as KiCadQueryTarget;
      return runtime
        .atom((get) => {
          const prepared = Option.getOrNull(get(preparedFor(target.environmentId)));
          return prepared === null
            ? Effect.never
            : fetchKiCadJson({
                prepared,
                cwd: target.cwd,
                path,
                schema,
                method,
              });
        })
        .pipe(
          Atom.swr({ staleTime: 1_000, revalidateOnMount: true }),
          Atom.setIdleTTL(5 * 60_000),
          Atom.withLabel(`${label}:${key}`),
        );
    });
    return (target: KiCadQueryTarget) => family(JSON.stringify(target));
  };
  return {
    session: query(
      "environment-data:kicad:viewer-session",
      "viewer-session",
      KiCadViewerSession,
      "POST",
    ),
    manifest: query("environment-data:kicad:manifest", "manifest", KiCadProjectManifest, "GET"),
  };
}
