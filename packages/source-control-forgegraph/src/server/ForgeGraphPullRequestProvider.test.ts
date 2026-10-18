import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as TestSourceControlHost from "@t3tools/source-control-testing/TestSourceControlHost";

import * as ForgeGraphApi from "./ForgeGraphApi.ts";
import * as ForgeGraphCredentials from "./ForgeGraphCredentials.ts";
import * as ForgeGraphPullRequestProvider from "./ForgeGraphPullRequestProvider.ts";

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

interface SentRequest {
  readonly method: string;
  /** The path below `/api`, without its query. */
  readonly path: string;
  readonly query: URLSearchParams;
  readonly body: unknown;
}

type Route = unknown | ((request: SentRequest) => readonly [status: number, body: unknown]);

/**
 * forgegraf.com answering `"METHOD /path"` (query stripped) from `routes`; anything else is a
 * 404. A function route picks its own status. Every request is recorded in order.
 */
function fakeForgeGraph(routes: Record<string, Route>) {
  const sent: Array<SentRequest> = [];
  const client = HttpClient.make((request: HttpClientRequest.HttpClientRequest) => {
    const url = new URL(request.url);
    assert.strictEqual(url.origin, "https://forgegraf.com");
    assert.strictEqual(request.headers.authorization, "Bearer fg_env");
    const entry: SentRequest = {
      method: request.method,
      path: url.pathname.slice("/api".length),
      query: url.searchParams,
      body:
        request.body._tag === "Uint8Array"
          ? decodeJson(new TextDecoder().decode(request.body.body))
          : undefined,
    };
    sent.push(entry);
    const route = routes[`${entry.method} ${entry.path}`];
    const [status, body] =
      route === undefined
        ? [404, { error: "Not found" }]
        : typeof route === "function"
          ? route(entry)
          : [200, route];
    return Effect.succeed(
      HttpClientResponse.fromWeb(request, new Response(encodeJson(body), { status })),
    );
  });
  const layer = ForgeGraphApi.layer.pipe(
    Layer.provide(ForgeGraphCredentials.layer),
    Layer.provide(TestSourceControlHost.layer()),
    // An environment token, so no test reads the forge CLI's file.
    Layer.provide(Layer.succeed(HostProcess.Environment, { FG_API_TOKEN: "fg_env" })),
    Layer.provide(Layer.succeed(HostProcess.HomeDirectory, "/nonexistent-home")),
    Layer.provide(FileSystem.layerNoop({})),
    Layer.provide(Path.layer),
    Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
  );
  const writes = () => sent.filter((request) => request.method !== "GET");
  return { layer, sent, writes };
}

const head = "949ccb85b7233f853a4cf3cfdac9d410d52ff2b4";
const target = {
  cwd: "/repo",
  host: "git.forgegraf.com",
  repository: "gmackie/t3code",
  number: 33,
};

const repositoryRoutes = {
  "GET /fg/repositories/resolve": {
    repository: {
      id: "repo-1",
      slug: "gmackie-t3code",
      owner: "gmackie",
      repoName: "t3code",
      defaultBranch: "custom-local",
      // Extra fields an older server leaks are ignored, never echoed.
      webhookSecret: "do-not-read",
    },
  },
  "GET /fg/apps": {
    apps: [
      { slug: "other", repositoryId: "repo-2" },
      { slug: "t3code", repositoryId: "repo-1" },
    ],
  },
};

const detail = (overrides: Record<string, unknown> = {}) => ({
  id: "cs-33",
  title: "T3CODE-26: skip ledger tests",
  status: "open",
  author: "gmackie",
  createdAt: "2026-10-18T19:33:04.084Z",
  headSha: head,
  sourceBranch: "feature/T3CODE-26",
  targetBranch: "custom-local",
  number: 33,
  prBackend: "forgejo",
  merge: null,
  comments: [],
  reviews: [],
  ...overrides,
});

const byNumber = {
  "GET /fg/prs": (request: SentRequest) =>
    [
      200,
      {
        prs:
          request.query.get("number") === "33"
            ? [
                {
                  id: "cs-33",
                  title: "x",
                  status: "open",
                  createdAt: "2026-10-18T19:33:04.084Z",
                  number: 33,
                },
              ]
            : [],
      },
    ] as const,
};

const run = <A, E>(
  routes: Record<string, Route>,
  use: (provider: Effect.Success<typeof ForgeGraphPullRequestProvider.make>) => Effect.Effect<A, E>,
) => {
  const fake = fakeForgeGraph(routes);
  return ForgeGraphPullRequestProvider.make.pipe(
    Effect.flatMap(use),
    Effect.map((result) => ({ result, fake })),
    Effect.provide(fake.layer),
  );
};

describe("ForgeGraphPullRequestProvider", () => {
  it.effect("lists the newest numbered pull requests in the asked state", () =>
    Effect.gen(function* () {
      const { result, fake } = yield* run(
        {
          ...repositoryRoutes,
          "GET /fg/prs": {
            prs: [
              { id: "cs-old", title: "old", status: "open", createdAt: "2026-10-01T00:00:00Z" },
              {
                id: "cs-closed",
                title: "closed",
                status: "closed",
                createdAt: "2026-10-19T00:00:00Z",
              },
              {
                id: "cs-native",
                title: "native",
                status: "open",
                createdAt: "2026-10-18T00:00:00Z",
              },
              { id: "cs-33", title: "new", status: "approved", createdAt: "2026-10-17T00:00:00Z" },
            ],
          },
          "GET /fg/prs/cs-old": detail({
            id: "cs-old",
            number: 12,
            createdAt: "2026-10-01T00:00:00Z",
          }),
          // Native, before ForgeGraph assigns per-repository numbers: left out, never numbered here.
          "GET /fg/prs/cs-native": detail({ id: "cs-native", number: null, prBackend: "native" }),
          "GET /fg/prs/cs-33": detail(),
        },
        (provider) =>
          provider.listChangeRequests({
            ...target,
            state: "open",
            involvement: "all",
            viewer: "gmackie",
            limit: 10,
          }),
      );
      assert.deepStrictEqual(
        result.items.map((item) => [item.number, item.state, item.url]),
        [
          [33, "open", "https://forgegraf.com/changesets/cs-33"],
          [12, "open", "https://forgegraf.com/changesets/cs-old"],
        ],
      );
      // An older server ignores `repository` and answers the thin list, so it is asked by app.
      assert.deepStrictEqual(
        fake.sent
          .filter((r) => r.path === "/fg/prs")
          .map((r) => [r.query.get("repository"), r.query.get("app")]),
        [
          ["gmackie/t3code", null],
          [null, "t3code"],
        ],
      );
      // The closed changeset was never read in full.
      assert.isFalse(fake.sent.some((r) => r.path === "/fg/prs/cs-closed"));
    }),
  );

  it.effect("reads past changesets without a number to fill the page", () =>
    Effect.gen(function* () {
      const { result } = yield* run(
        {
          ...repositoryRoutes,
          "GET /fg/prs": {
            prs: [
              // Forgejo-backed changesets that never got a Forgejo PR, newer than the real one.
              { id: "cs-a", title: "a", status: "open", createdAt: "2026-10-18T00:00:00Z" },
              { id: "cs-b", title: "b", status: "open", createdAt: "2026-10-17T00:00:00Z" },
              { id: "cs-17", title: "c", status: "open", createdAt: "2026-10-04T00:00:00Z" },
            ],
          },
          "GET /fg/prs/cs-a": detail({ id: "cs-a", number: null }),
          "GET /fg/prs/cs-b": detail({ id: "cs-b", number: null }),
          "GET /fg/prs/cs-17": detail({ id: "cs-17", number: 17 }),
        },
        (provider) =>
          provider.listChangeRequests({
            ...target,
            state: "open",
            involvement: "all",
            viewer: "gmackie",
            limit: 1,
          }),
      );
      assert.deepStrictEqual(
        result.items.map((item) => item.number),
        [17],
      );
      assert.isFalse(result.truncated);
    }),
  );

  it.effect("reads ForgeGraph CI on the head as checks linked to their run pages", () =>
    Effect.gen(function* () {
      const { result, fake } = yield* run(
        {
          ...repositoryRoutes,
          ...byNumber,
          "GET /fg/prs/cs-33": detail(),
          "GET /fg/ci/gate": {
            status: "pending",
            builds: [
              { id: "b-1", pipelineName: "ci", status: "running" },
              { id: "b-2", pipelineName: "lint", status: "passed" },
            ],
          },
        },
        (provider) => provider.getChangeRequest(target),
      );
      assert.deepStrictEqual(
        result.checks.map((check) => [check.name, check.status, check.url]),
        [
          ["ci", "pending", "https://forgegraf.com/ci/b-1"],
          ["lint", "success", "https://forgegraf.com/ci/b-2"],
        ],
      );
      assert.strictEqual(result.checksState, "pending");
      assert.strictEqual(result.headSha, head);
      assert.deepStrictEqual(
        [...fake.sent.find((r) => r.path === "/fg/ci/gate")!.query],
        [
          ["app", "t3code"],
          ["sha", head],
        ],
      );
      assert.deepStrictEqual(result.viewerPermissions.actions, [
        "merge",
        "enable-auto-merge",
        "close",
      ]);
      assert.deepStrictEqual(result.mergeCapabilities, { merge: true, squash: true, rebase: true });
    }),
  );

  it.effect("offers native pull requests neither merge-when-green nor rebase", () =>
    Effect.gen(function* () {
      const { result } = yield* run(
        { ...repositoryRoutes, ...byNumber, "GET /fg/prs/cs-33": detail({ prBackend: "native" }) },
        (provider) => provider.getViewerPermissions(target),
      );
      assert.deepStrictEqual(result.actions, ["merge", "close"]);
    }),
  );

  it.effect("pins a review to the head it was read at", () =>
    Effect.gen(function* () {
      const { fake } = yield* run(
        {
          ...repositoryRoutes,
          ...byNumber,
          "GET /fg/prs/cs-33": detail(),
          "POST /fg/prs/cs-33/review": () => [201, { id: "r-1" }] as const,
        },
        (provider) =>
          provider.submitReview({ ...target, verdict: "approve", body: "", comments: [] }),
      );
      const [review] = fake.writes();
      const body = review?.body as Record<string, unknown>;
      assert.strictEqual(body.expectedHeadSha, head);
      assert.strictEqual(body.verdict, "approved");
      assert.isString(body.idempotencyKey);
      assert.notProperty(body, "body");
    }),
  );

  it.effect("says the head moved when ForgeGraph refuses a review as stale", () =>
    Effect.gen(function* () {
      const fake = fakeForgeGraph({
        ...repositoryRoutes,
        ...byNumber,
        "GET /fg/prs/cs-33": detail(),
        "POST /fg/prs/cs-33/review": () => [409, { error: "Head moved" }] as const,
      });
      const error = yield* ForgeGraphPullRequestProvider.make.pipe(
        Effect.flatMap((provider) =>
          provider.submitReview({
            ...target,
            verdict: "request-changes",
            body: "no",
            comments: [],
          }),
        ),
        Effect.flip,
        Effect.provide(fake.layer),
      );
      assert.strictEqual(error.reason, "failed");
      assert.match(error.detail, /moved since it was read/u);
    }),
  );

  it.effect("merges when green on the read head", () =>
    Effect.gen(function* () {
      const { fake } = yield* run(
        {
          ...repositoryRoutes,
          ...byNumber,
          "GET /fg/prs/cs-33": detail(),
          "POST /fg/prs/cs-33/merge": () => [200, { merged: false, scheduled: true }] as const,
        },
        (provider) =>
          provider.runAction({ ...target, action: "enable-auto-merge", mergeMethod: "squash" }),
      );
      assert.deepStrictEqual(
        fake.writes().map((write) => write.body),
        [{ strategy: "squash", whenGreen: true, expectedHeadSha: head }],
      );
    }),
  );

  it.effect("refuses merge-when-green on a native pull request before sending anything", () =>
    Effect.gen(function* () {
      const fake = fakeForgeGraph({
        ...repositoryRoutes,
        ...byNumber,
        "GET /fg/prs/cs-33": detail({ prBackend: "native" }),
      });
      const error = yield* ForgeGraphPullRequestProvider.make.pipe(
        Effect.flatMap((provider) =>
          provider.runAction({ ...target, action: "enable-auto-merge" }),
        ),
        Effect.flip,
        Effect.provide(fake.layer),
      );
      assert.match(error.detail, /native/u);
      assert.deepStrictEqual(fake.writes(), []);
    }),
  );

  it.effect("reports a number ForgeGraph does not know as not found", () =>
    Effect.gen(function* () {
      const fake = fakeForgeGraph({ ...repositoryRoutes, ...byNumber });
      const error = yield* ForgeGraphPullRequestProvider.make.pipe(
        Effect.flatMap((provider) => provider.getChangeRequest({ ...target, number: 404 })),
        Effect.flip,
        Effect.provide(fake.layer),
      );
      assert.strictEqual(error.reason, "not-found");
    }),
  );
});

describe("ForgeGraphPullRequestProvider against a FORGE-138 server", () => {
  const summary = (number: number, overrides: Record<string, unknown> = {}) => ({
    ...detail({ id: `cs-${number}`, number }),
    state: "open",
    isDraft: false,
    url: `https://forgegraf.com/changesets/cs-${number}`,
    ci: null,
    review: null,
    updatedAt: "2026-10-18T20:00:00.000Z",
    comments: undefined,
    reviews: undefined,
    ...overrides,
  });
  // The repository resolves with no app at all: nothing should need one.
  const resolveOnly = {
    "GET /fg/repositories/resolve": {
      repository: {
        id: "repo-1",
        slug: "gmackie-t3code",
        owner: "gmackie",
        repoName: "t3code",
        prBackend: "native",
        storageBackend: "artifacts",
        cloneUrl: "https://gitgw.forgegraf.com/gmackie/t3code.git",
      },
    },
    "GET /fg/apps": { apps: [] },
  };

  it.effect("lists by repository in pages, without reading each pull request", () =>
    Effect.gen(function* () {
      const { result, fake } = yield* run(
        {
          ...resolveOnly,
          "GET /fg/prs": (request: SentRequest) =>
            request.query.get("cursor") === null
              ? ([
                  200,
                  { prs: [summary(140, { ci: "running" }), summary(139)], nextCursor: "c-2" },
                ] as const)
              : ([200, { prs: [summary(12, { ci: "pass" })], nextCursor: "c-3" }] as const),
        },
        (provider) =>
          provider.listChangeRequests({
            ...target,
            state: "open",
            involvement: "all",
            viewer: "gmackie",
            limit: 3,
          }),
      );
      assert.deepStrictEqual(
        result.items.map((item) => [item.number, item.checksState ?? null]),
        [
          [140, "pending"],
          [139, null],
          [12, "passing"],
        ],
      );
      assert.isTrue(result.truncated);
      assert.deepStrictEqual(
        fake.sent.map((r) => [r.path, r.query.get("limit"), r.query.get("cursor")]),
        [
          ["/fg/prs", "3", null],
          ["/fg/prs", "1", "c-2"],
        ],
      );
    }),
  );

  it.effect("reads a native pull request by its number, with no app for CI", () =>
    Effect.gen(function* () {
      const { result, fake } = yield* run(
        {
          ...resolveOnly,
          "GET /fg/prs/by-number": (request: SentRequest) =>
            request.query.get("number") === "140" &&
            request.query.get("repository") === "gmackie/t3code"
              ? ([
                  200,
                  {
                    ...summary(140, { ci: "fail" }),
                    prBackend: "native",
                    body: "Native body",
                    mergeStrategies: ["merge", "squash", "fast-forward"],
                    comments: [],
                    reviews: [],
                  },
                ] as const)
              : ([404, { error: "PR not found" }] as const),
        },
        (provider) => provider.getChangeRequest({ ...target, number: 140 }),
      );
      assert.strictEqual(result.number, 140);
      assert.strictEqual(result.body, "Native body");
      assert.strictEqual(result.checksState, "failing");
      assert.deepStrictEqual(result.checks, []);
      assert.deepStrictEqual(result.mergeCapabilities, {
        merge: true,
        squash: true,
        rebase: false,
      });
      // Native when-green waits on FORGE-138 item 7.
      assert.deepStrictEqual(result.viewerPermissions.actions, ["merge", "close"]);
      assert.isFalse(fake.sent.some((r) => r.path === "/fg/prs" || r.path === "/fg/ci/gate"));
    }),
  );

  it.effect("falls back to the app listing when the server refuses a repository listing", () =>
    Effect.gen(function* () {
      const { result } = yield* run(
        {
          ...repositoryRoutes,
          "GET /fg/prs": (request: SentRequest) =>
            request.query.get("app") === null
              ? ([400, { error: "app query parameter required (or all=true)" }] as const)
              : ([
                  200,
                  {
                    prs: [
                      {
                        id: "cs-33",
                        title: "x",
                        status: "open",
                        createdAt: "2026-10-18T19:33:04.084Z",
                      },
                    ],
                  },
                ] as const),
          "GET /fg/prs/cs-33": detail(),
        },
        (provider) =>
          provider.listChangeRequests({
            ...target,
            state: "open",
            involvement: "all",
            viewer: "gmackie",
            limit: 10,
          }),
      );
      assert.deepStrictEqual(
        result.items.map((item) => item.number),
        [33],
      );
    }),
  );
});
