/**
 * The reads both ForgeGraph providers address a pull request through.
 *
 * A server with FORGE-138 lists a repository's pull requests by `owner/repo` with their numbers,
 * and finds one by number directly. An older one lists them only by app, without numbers, so a
 * pull request is found in three hops there: the repository, the app that lists it, and the
 * changeset behind the number. Each read tries the direct route first and falls back when the
 * server answers that it has none; nothing assumes which server it is talking to.
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
/** The repository listing's own page cap. */
const LIST_PAGE = 100;
/** Details read at once from an older server, whose list carries no number or branch. */
const DETAIL_CONCURRENCY = 6;
/**
 * How far past `limit` a listing reads to fill it. Changesets without a number (a Forgejo-backed
 * one that never got a Forgejo PR) are listed but cannot be shown, and must not use up the page.
 */
const UNNUMBERED_READ_FACTOR = 4;
const MAX_LIST_PAGES = 5;

export interface ForgeGraphRepositoryTarget {
  readonly repository: Json.ForgeGraphRepository;
  /** The app an older server lists this repository's pull requests under; null when it has none. */
  readonly appSlug: string | null;
}

export interface ForgeGraphPullPage {
  /** Newest first, only pull requests T3 can address by number, at most `limit` of them. */
  readonly pulls: ReadonlyArray<Json.NumberedPull>;
  readonly truncated: boolean;
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

  /** Runs `fallback` where the server answered that it has no such route or record. */
  const orOnMissing =
    <A, R>(
      statuses: ReadonlyArray<number>,
      fallback: Effect.Effect<A, ForgeGraphApi.ForgeGraphApiError, R>,
    ) =>
    <R2>(effect: Effect.Effect<A, ForgeGraphApi.ForgeGraphApiError, R2>) =>
      effect.pipe(
        Effect.catchTags({
          ForgeGraphApiError: (error) =>
            error.status !== null && statuses.includes(error.status)
              ? fallback
              : Effect.fail(error),
        }),
      );

  const repositories = yield* Cache.makeWith(
    (repository: string) =>
      Effect.gen(function* () {
        const [owner = "", repo = ""] = repository.split("/");
        const query = new URLSearchParams({ owner, repo });
        // A newer server answers 404 with `repository: null` for a missing repository and for
        // another workspace's alike; an older one answers 200 with null.
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

  /** The app slug an older server's listing and CI gate need; fails for a repository with none. */
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

  const pullById = (operation: string, id: string) =>
    read({ operation, path: `/fg/prs/${encodeURIComponent(id)}` }, Json.ForgeGraphPull);

  /** An older server's listing: every changeset of the app, thin, read in full one by one. */
  const listByApp = Effect.fn("ForgeGraphLookups.listByApp")(function* (
    operation: string,
    repository: string,
    state: "open" | "closed" | "merged" | "all",
    limit: number,
  ) {
    const app = yield* appSlug(operation, repository);
    const { prs } = yield* read(
      { operation, path: `/fg/prs?${new URLSearchParams({ app })}` },
      Json.ForgeGraphPullList,
    );
    const wanted = prs
      .filter((pull) => pull.status !== "draft" && Json.matchesListState(pull.status, state))
      .toSorted((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt));
    const budget = Math.min(wanted.length, limit * UNNUMBERED_READ_FACTOR);
    const pulls: Array<Json.NumberedPull> = [];
    let consumed = 0;
    while (pulls.length < limit && consumed < budget) {
      const batch = wanted.slice(consumed, Math.min(budget, consumed + limit - pulls.length));
      consumed += batch.length;
      const details = yield* Effect.forEach(batch, (item) => pullById(operation, item.id), {
        concurrency: DETAIL_CONCURRENCY,
      });
      pulls.push(...details.filter(Json.isNumbered));
    }
    return { pulls, truncated: consumed < wanted.length } satisfies ForgeGraphPullPage;
  });

  /**
   * A repository's newest pull requests in a state. A newer server pages them with numbers in one
   * read; an older one answers 400 for a listing without an app, and is read the old way.
   */
  const listPulls = Effect.fn("ForgeGraphLookups.listPulls")(
    function* (
      operation: string,
      repository: string,
      state: "open" | "closed" | "merged" | "all",
      limit: number,
    ) {
      const pulls: Array<Json.NumberedPull> = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const query = new URLSearchParams({
          repository,
          state,
          limit: String(Math.min(LIST_PAGE, limit - pulls.length)),
        });
        if (cursor !== null) query.set("cursor", cursor);
        const page = yield* read({ operation, path: `/fg/prs?${query}` }, Json.ForgeGraphPullList);
        // Only the repository listing pages; anything else is a server that did not understand it.
        if (page.nextCursor === undefined)
          return yield* listByApp(operation, repository, state, limit);
        pulls.push(...page.prs.filter(Json.isNumbered).slice(0, limit - pulls.length));
        cursor = page.prs.length === 0 ? null : page.nextCursor;
        pages += 1;
      } while (cursor !== null && pulls.length < limit && pages < MAX_LIST_PAGES);
      return { pulls, truncated: cursor !== null } satisfies ForgeGraphPullPage;
    },
    (effect, operation, repository, state, limit) =>
      effect.pipe(orOnMissing([400], listByApp(operation, repository, state, limit))),
  );

  /** An older server's branch lookup: the app's changesets on one branch, read in full. */
  const branchByApp = Effect.fn("ForgeGraphLookups.branchByApp")(function* (
    operation: string,
    repository: string,
    branch: string,
    state: "open" | "closed" | "merged" | "all",
    limit: number,
  ) {
    const app = yield* appSlug(operation, repository);
    const { prs } = yield* read(
      {
        operation,
        path: `/fg/prs?${new URLSearchParams({ app, vcsType: "git", changeId: branch })}`,
      },
      Json.ForgeGraphPullList,
    );
    return yield* Effect.forEach(
      prs
        .filter((pull) => Json.matchesListState(pull.status, state))
        .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit),
      (item) => pullById(operation, item.id),
      { concurrency: DETAIL_CONCURRENCY },
    );
  });

  /**
   * The pull requests whose head is `branch`, newest first. A newer server's listing carries the
   * branch, so its newest page is filtered here; an older one is asked by branch through the app.
   */
  const listByBranch = Effect.fn("ForgeGraphLookups.listByBranch")(
    function* (
      operation: string,
      repository: string,
      branch: string,
      state: "open" | "closed" | "merged" | "all",
      limit: number,
    ) {
      const page = yield* read(
        {
          operation,
          path: `/fg/prs?${new URLSearchParams({ repository, state, limit: String(LIST_PAGE) })}`,
        },
        Json.ForgeGraphPullList,
      );
      if (page.nextCursor === undefined)
        return yield* branchByApp(operation, repository, branch, state, limit);
      return page.prs.filter((pull) => pull.sourceBranch === branch).slice(0, limit);
    },
    (effect, operation, repository, branch, state, limit) =>
      effect.pipe(orOnMissing([400], branchByApp(operation, repository, branch, state, limit))),
  );

  /** An older server's number lookup, through the app's listing. */
  const changesetIds = yield* Cache.makeWith(
    (key: string) =>
      Effect.gen(function* () {
        const separator = key.lastIndexOf("#");
        const repository = key.slice(0, separator);
        const number = key.slice(separator + 1);
        const app = yield* appSlug("findPullRequest", repository);
        const { prs } = yield* read(
          { operation: "findPullRequest", path: `/fg/prs?${new URLSearchParams({ app, number })}` },
          Json.ForgeGraphPullList,
        );
        // A server that ignores `number` lists everything; only an item carrying it answers.
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

  /**
   * The pull request a number names, read in full. An older server routes `/prs/by-number` to a
   * changeset id and answers 404, which is also the answer for a missing number, so both go on to
   * the app's listing before the number is reported missing.
   */
  const pull = (operation: string, repository: string, number: number) =>
    read(
      {
        operation,
        path: `/fg/prs/by-number?${new URLSearchParams({ repository, number: String(number) })}`,
      },
      Json.ForgeGraphPull,
    ).pipe(
      orOnMissing(
        [404],
        Cache.get(changesetIds, `${repository.toLowerCase()}#${number}`).pipe(
          Effect.flatMap((id) => pullById(operation, id)),
        ),
      ),
      Effect.filterOrFail(Json.isNumbered, () =>
        notFound(operation, `ForgeGraph pull request #${number} has no branch to read.`),
      ),
    );

  /**
   * CI builds on a commit. The gate is keyed by app, so a repository without one, or a server or
   * app with no CI, reads as no builds rather than a failure.
   */
  const gate = (operation: string, repository: string, sha: string | null | undefined) =>
    sha
      ? appSlug(operation, repository).pipe(
          Effect.flatMap((app) =>
            read(
              { operation, path: `/fg/ci/gate?${new URLSearchParams({ app, sha })}` },
              Json.ForgeGraphGate,
            ),
          ),
          Effect.catchTags({
            ForgeGraphApiError: (error) =>
              error.reason === "unauthenticated" || error.reason === "rate-limited"
                ? Effect.fail(error)
                : Effect.succeed(null),
          }),
        )
      : Effect.succeed(null);

  return { api, read, target, appSlug, listPulls, listByBranch, pull, pullById, gate };
});
