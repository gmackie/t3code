import { EnvironmentId, GameViewerTicket, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { Atom } from "effect/reactivity";
import type { PreparedConnection } from "../connection/model.ts";
import { EnvironmentRegistry } from "../connection/registry.ts";
import { environmentEndpointUrl } from "../environment/endpoint.ts";
import { ManagedRelayDpopSigner } from "../relay/managedRelay.ts";
import { executeEnvironmentHttpRequest } from "../rpc/http.ts";
import { createEnvironmentSessionAtoms } from "./session.ts";

export type GameQueryTarget = {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly threadId: ThreadId;
};

const gameEndpointUrl = (base: string, path: string, cwd: string): string => {
  const url = new URL(environmentEndpointUrl(base, `/api/game/${path}`));
  url.searchParams.set("cwd", cwd);
  return url.toString();
};

export class GameRequestError extends Schema.TaggedError<GameRequestError>()("GameRequestError", {
  message: Schema.String,
}) {}

export const fetchGameJson = Effect.fn("clientRuntime.fetchGameJson")(function* <A>(input: {
  prepared: PreparedConnection;
  cwd: string;
  threadId: ThreadId;
  path: string;
  schema: Schema.Codec<A, unknown>;
  method: "GET" | "POST";
  signer?: Option.Option<ManagedRelayDpopSigner["Service"]>;
}) {
  const signer =
    input.signer !== undefined ? input.signer : yield* Effect.serviceOption(ManagedRelayDpopSigner);
  const url = gameEndpointUrl(input.prepared.httpBaseUrl, input.path, input.cwd);
  const authorization = input.prepared.httpAuthorization;
  const client = yield* HttpClient.HttpClient;
  let request = HttpClientRequest.make(input.method)(url).pipe(
    HttpClientRequest.bodyJsonUnsafe({ cwd: input.cwd, threadId: input.threadId }),
  );
  if (authorization?._tag === "Bearer") {
    request = HttpClientRequest.setHeader(
      request,
      "authorization",
      `Bearer ${authorization.token}`,
    );
  } else if (authorization?._tag === "Dpop") {
    if (Option.isNone(signer)) {
      return yield* new GameRequestError({
        message: "No DPoP signer is available to authorize the Unity request.",
      });
    }
    const proof = yield* signer.value
      .createProof({
        method: input.method,
        url,
        accessToken: authorization.accessToken,
      })
      .pipe(Effect.mapError((cause) => new GameRequestError({ message: String(cause) })));
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
    Effect.mapError((error) => new GameRequestError({ message: String(error) })),
  );
  if (response.status < 200 || response.status >= 300) {
    return yield* new GameRequestError({
      message:
        response.status === 404
          ? "This environment does not support Unity mode. Update its T3 Code server to a version with Unity support."
          : response.status === 401 || response.status === 403
            ? "Reconnect to this environment to open Unity mode."
            : `Unable to open Unity mode (server status ${response.status}). Check that the workspace is available.`,
    });
  }
  return yield* response.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(input.schema)));
});

export function createGameState<R, E>(
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
      const target = JSON.parse(key) as GameQueryTarget;
      return runtime
        .atom((get) => {
          const prepared = Option.getOrNull(get(preparedFor(target.environmentId)));
          return prepared === null
            ? Effect.never
            : fetchGameJson({
                prepared,
                cwd: target.cwd,
                threadId: target.threadId,
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
    return (target: GameQueryTarget) => family(JSON.stringify(target));
  };
  return { session: query("environment-data:game:ticket", "ticket", GameViewerTicket, "POST") };
}
