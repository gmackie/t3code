import { EnvironmentId, KiCadProjectManifest, KiCadViewerSession } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { Atom } from "effect/unstable/reactivity";
import type { PreparedConnection } from "../connection/model.ts";
import { EnvironmentRegistry } from "../connection/registry.ts";
import { environmentEndpointUrl } from "../environment/endpoint.ts";
import { ManagedRelayDpopSigner } from "../relay/managedRelay.ts";
import { executeAuthenticatedEnvironmentHttpRequest } from "./environmentHttpAuth.ts";
import { RemoteEnvironmentAuthorization } from "../authorization/service.ts";
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
  const signer = input.signer ?? (yield* Effect.serviceOption(ManagedRelayDpopSigner));
  const remoteAuthorization = yield* Effect.serviceOption(RemoteEnvironmentAuthorization);
  const response = yield* executeAuthenticatedEnvironmentHttpRequest({
    prepared: input.prepared,
    signer,
    remoteAuthorization,
    group: "auth",
    method: input.method,
    url: (base) => kiCadEndpointUrl(base, input.path, input.cwd),
    timeoutMs: 15_000,
    isUnauthorizedResponse: (response) => response.status === 401,
    request: ({ headers, url }) =>
      Effect.gen(function* () {
        const client = yield* HttpClient.HttpClient;
        let request = HttpClientRequest.make(input.method)(url);
        if (headers.authorization)
          request = HttpClientRequest.setHeader(request, "authorization", headers.authorization);
        if (headers.dpop) request = HttpClientRequest.setHeader(request, "dpop", headers.dpop);
        return yield* client
          .execute(request)
          .pipe(Effect.mapError((cause) => new KiCadRequestError({ message: String(cause) })));
      }),
  }).pipe(
    Effect.mapError((error) =>
      error instanceof KiCadRequestError
        ? error
        : new KiCadRequestError({ message: String(error) }),
    ),
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
