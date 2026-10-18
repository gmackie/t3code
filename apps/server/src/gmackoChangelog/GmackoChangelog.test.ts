import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as GmackoChangelog from "./GmackoChangelog.ts";

const UPSTREAM = [
  {
    tag_name: "v0.1.1-nightly.20261018.3315",
    target_commitish: "9c161462c94f",
    html_url: "https://github.com/pingdotgg/t3code/releases/tag/v0.1.1-nightly.20261018.3315",
    body: "## What's Changed",
    draft: false,
    published_at: "2026-10-18T13:53:58Z",
  },
];

const layerHttpClient = (handler: (url: string) => Response) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, handler(request.url))),
    ),
  );

describe("GmackoChangelog service", () => {
  it.live("serves the cache until a refresh is requested", () => {
    let requests = 0;
    return Effect.gen(function* () {
      const service = yield* GmackoChangelog.make;
      const first = yield* service.get({});
      assert.equal(first.upstream[0]?.tag, "v0.1.1-nightly.20261018.3315");
      assert.isNull(first.error);
      assert.isNotNull(first.fetchedAt);
      yield* service.get({});
      assert.equal(requests, 2);
      yield* service.get({ refresh: true });
      assert.equal(requests, 4);
    }).pipe(
      Effect.provide(
        layerHttpClient((url) => {
          requests++;
          return Response.json(url.includes("pingdotgg") ? UPSTREAM : []);
        }),
      ),
    );
  });

  it.live("keeps the last good lists when a refresh fails", () => {
    let failing = false;
    return Effect.gen(function* () {
      const service = yield* GmackoChangelog.make;
      const good = yield* service.get({});
      failing = true;
      const failed = yield* service.get({ refresh: true });
      assert.deepStrictEqual(failed.upstream, good.upstream);
      assert.equal(failed.fetchedAt, good.fetchedAt);
      assert.isNotNull(failed.error);
    }).pipe(
      Effect.provide(
        layerHttpClient((url) =>
          failing
            ? new Response("rate limited", { status: 403 })
            : Response.json(url.includes("pingdotgg") ? UPSTREAM : []),
        ),
      ),
    );
  });
});
