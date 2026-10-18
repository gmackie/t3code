/**
 * The reads both ForgeGraph providers address a pull request through. ForgeGraph keys pull
 * requests by changeset id and lists them by app, while T3 names them `owner/repo` and number,
 * so a pull request is found in three hops: the repository, the app that lists it, and the
 * changeset behind the number. The first two rarely change and are cached; a failed read is not.
 *
 * @module source-control-forgegraph/server/forgeGraphLookups
 */
import * as Cache from "effect/Cache";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import * as ForgeGraphApi from "./ForgeGraphApi.ts";
import * as Json from "./forgeGraphJson.ts";

const REPOSITORY_TTL = Duration.minutes(5);
/** A changeset never changes which number it carries, so its id is kept for as long as it fits. */
const CHANGESET_TTL = Duration.hours(1);

export interface ForgeGraphRepositoryTarget {
  readonly repository: Json.ForgeGraphRepository;
  /** The app ForgeGraph lists this repository's pull requests under; null when it has none. */
  readonly appSlug: string | null;
}

const unreadable = (operation: string, cause: unknown) =>
  new ForgeGraphApi.ForgeGraphApiError({
    operation,
    status: null,
    reason: "failed",
    code: null,
    detail: "ForgeGraph returned an unreadable response.",
    cause,
  });

const notFound = (operation: string, detail: string) =>
  new ForgeGraphApi.ForgeGraphApiError({
    operation,
    status: 404,
    reason: "not-found",
    code: null,
    detail,
  });

const cacheSuccessOnly = (ttl: Duration.Duration) => (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isSuccess(exit) ? ttl : Duration.zero;

/** @public Constructed once by each provider over the shared API. */
export const make = Effect.gen(function* () {
  const api = yield* ForgeGraphApi.ForgeGraphApi;

  const read = <S extends Schema.Codec<unknown, unknown, never, never>>(
    request: ForgeGraphApi.ForgeGraphApiRequest,
    schema: S,
  ) =>
    api
      .request(request)
      .pipe(
        Effect.flatMap((raw) =>
          Schema.decodeEffect(Schema.fromJsonString(schema))(raw).pipe(
            Effect.mapError((cause) => unreadable(request.operation, cause)),
          ),
        ),
      );

  const repositories = yield* Cache.makeWith(
    (repository: string) =>
      Effect.gen(function* () {
        const [owner = "", repo = ""] = repository.split("/");
        const query = new URLSearchParams({ owner, repo });
        const resolved = yield* read(
          { operation: "resolveRepository", path: `/fg/repositories/resolve?${query}` },
          Json.ForgeGraphResolve,
        );
        if (resolved.repository === null)
          return yield* notFound(
            "resolveRepository",
            `ForgeGraph has no repository ${repository}.`,
          );
        const found = resolved.repository;
        const { apps } = yield* read(
          { operation: "resolveRepository", path: "/fg/apps" },
          Json.ForgeGraphApps,
        );
        const app = apps.find((candidate) => candidate.repositoryId === found.id);
        return {
          repository: found,
          appSlug: app?.slug ?? null,
        } satisfies ForgeGraphRepositoryTarget;
      }),
    { capacity: 64, timeToLive: cacheSuccessOnly(REPOSITORY_TTL) },
  );

  const target = (operation: string, repository: string) =>
    Cache.get(repositories, repository.toLowerCase()).pipe(
      Effect.mapError((error) =>
        error.operation === operation
          ? error
          : new ForgeGraphApi.ForgeGraphApiError({ ...error, operation }),
      ),
    );

  /** The app slug the listing and CI routes need, failing for a repository with no app. */
  const appSlug = (operation: string, repository: string) =>
    target(operation, repository).pipe(
      Effect.flatMap((found) =>
        found.appSlug === null
          ? Effect.fail(
              notFound(
                operation,
                `ForgeGraph lists pull requests by app, and ${repository} has no app.`,
              ),
            )
          : Effect.succeed(found.appSlug),
      ),
    );

  const changesetIds = yield* Cache.makeWith(
    (key: string) =>
      Effect.gen(function* () {
        const separator = key.lastIndexOf("#");
        const repository = key.slice(0, separator);
        const number = key.slice(separator + 1);
        const app = yield* appSlug("findPullRequest", repository);
        const { prs } = yield* read(
          {
            operation: "findPullRequest",
            path: `/fg/prs?${new URLSearchParams({ app, number })}`,
          },
          Json.ForgeGraphPullList,
        );
        // An older server ignores `number` and lists everything; only an item carrying the number
        // asked for answers it.
        const match = prs.find((pull) => pull.number === Number(number));
        if (match === undefined)
          return yield* notFound(
            "findPullRequest",
            `ForgeGraph has no pull request #${number} in ${repository}.`,
          );
        return match.id;
      }),
    { capacity: 512, timeToLive: cacheSuccessOnly(CHANGESET_TTL) },
  );

  const pullById = (operation: string, id: string) =>
    read({ operation, path: `/fg/prs/${encodeURIComponent(id)}` }, Json.ForgeGraphPullDetail);

  /** The pull request a number names, read in full. */
  const pull = (operation: string, repository: string, number: number) =>
    Cache.get(changesetIds, `${repository.toLowerCase()}#${number}`).pipe(
      Effect.flatMap((id) => pullById(operation, id)),
      Effect.filterOrFail(Json.isNumbered, () =>
        notFound(operation, `ForgeGraph pull request #${number} has no branch to read.`),
      ),
    );

  /** CI on a commit; a server or app that has none reads as no checks rather than a failure. */
  const gate = (operation: string, app: string, sha: string | null | undefined) =>
    sha
      ? read(
          { operation, path: `/fg/ci/gate?${new URLSearchParams({ app, sha })}` },
          Json.ForgeGraphGate,
        ).pipe(
          Effect.catchTags({
            ForgeGraphApiError: (error) =>
              error.reason === "unauthenticated" || error.reason === "rate-limited"
                ? Effect.fail(error)
                : Effect.succeed(null),
          }),
        )
      : Effect.succeed(null);

  return { api, read, target, appSlug, pull, pullById, gate };
});

export type ForgeGraphLookups = Effect.Success<typeof make>;
