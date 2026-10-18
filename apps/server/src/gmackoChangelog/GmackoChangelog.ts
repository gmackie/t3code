import type {
  GmackoChangelog as GmackoChangelogData,
  GmackoChangelogInput,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import packageJson from "../../package.json" with { type: "json" };
import { GitHubRelease, mapGmackoChangelog } from "./mapping.ts";

const UPSTREAM_RELEASES_URL = "https://api.github.com/repos/pingdotgg/t3code/releases?per_page=100";
const GMACKO_RELEASES_URL = "https://api.github.com/repos/gmackie/t3code/releases?per_page=100";

/** GitHub allows 60 unauthenticated requests an hour; a refresh costs two. */
const CACHE_TTL_MS = 15 * 60 * 1000;
/** After a failed refresh, serve the last good copy for this long before retrying. */
const RETRY_AFTER_FAILURE_MS = 60 * 1000;
const FETCH_TIMEOUT = "15 seconds";

export class GmackoChangelog extends Context.Service<
  GmackoChangelog,
  {
    /**
     * Upstream nightlies and GMACKO builds, mapped onto each other. Cached;
     * `refresh` bypasses the cache. Never fails: a failed refresh returns the
     * last good lists with `error` set.
     */
    readonly get: (input: GmackoChangelogInput) => Effect.Effect<GmackoChangelogData>;
  }
>()("t3/gmackoChangelog/GmackoChangelog") {}

const decodeReleases = Schema.decodeUnknownEffect(Schema.Array(GitHubRelease));

export const make = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;
  const semaphore = yield* Semaphore.make(1);

  let current: GmackoChangelogData = {
    upstream: [],
    builds: [],
    installedVersion: packageJson.version,
    fetchedAt: null,
    error: null,
  };
  let fetchedAtMs: number | null = null;
  let failedAtMs: number | null = null;

  const fetchReleases = (url: string) =>
    httpClient
      .execute(
        HttpClientRequest.get(url).pipe(
          HttpClientRequest.setHeaders({
            Accept: "application/vnd.github+json",
            "User-Agent": "t3code-gmacko-changelog",
          }),
        ),
      )
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap((response) => response.json),
        Effect.flatMap(decodeReleases),
      );

  const refresh = Effect.fn("GmackoChangelog.refresh")(function* (force: boolean) {
    const now = yield* Clock.currentTimeMillis;
    const isWithin = (sinceMs: number | null, windowMs: number) =>
      sinceMs !== null && now >= sinceMs && now - sinceMs < windowMs;
    if (!force && isWithin(fetchedAtMs, CACHE_TTL_MS)) return current;
    if (!force && isWithin(failedAtMs, RETRY_AFTER_FAILURE_MS)) return current;

    const fetched = yield* Effect.all(
      [fetchReleases(UPSTREAM_RELEASES_URL), fetchReleases(GMACKO_RELEASES_URL)],
      {
        concurrency: 2,
      },
    ).pipe(
      Effect.timeout(FETCH_TIMEOUT),
      Effect.catchCause(() => Effect.succeed(null)),
    );
    if (fetched === null) {
      failedAtMs = now;
      current = {
        ...current,
        error:
          "Couldn't load releases from GitHub. It may be unreachable or rate limiting this server.",
      };
      return current;
    }

    const [upstreamReleases, gmackoReleases] = fetched;
    fetchedAtMs = now;
    failedAtMs = null;
    current = {
      ...mapGmackoChangelog({ upstreamReleases, gmackoReleases }),
      installedVersion: packageJson.version,
      fetchedAt: DateTime.formatIso(DateTime.makeUnsafe(now)),
      error: null,
    };
    return current;
  });

  return GmackoChangelog.of({
    get: (input) => semaphore.withPermits(1)(refresh(input.refresh === true)),
  });
});

export const layer = Layer.effect(GmackoChangelog, make);
