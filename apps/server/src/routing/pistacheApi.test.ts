import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientResponse } from "effect/http";

import { makePistacheApi } from "./pistacheApi.ts";
import { metricsFixture, snapshotFixture } from "./pistacheApi.fixture.ts";

const config = { baseUrl: "http://router.test:8080", token: "router-secret" } as const;

function fixture(responder?: (path: string) => Response) {
  const requests: Array<{ path: string; query: URLSearchParams }> = [];
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      expect(request.headers.authorization).toBe("Bearer router-secret");
      const url = new URL(request.url);
      requests.push({ path: url.pathname, query: url.searchParams });
      const response =
        responder?.(url.pathname) ??
        (url.pathname === "/api/v1/metrics"
          ? Response.json(metricsFixture)
          : Response.json(snapshotFixture));
      return HttpClientResponse.fromWeb(request, response);
    }),
  );
  return {
    requests,
    api: makePistacheApi.pipe(Effect.provideService(HttpClient.HttpClient, http)),
  };
}

describe("Pistache API", () => {
  it.effect("reads live rollups and keeps only the series the page shows", () =>
    Effect.gen(function* () {
      const test = fixture();
      const api = yield* test.api;
      const rows = yield* api.metrics(config, 1788700000.7);
      expect(rows.map((row) => row.series)).toEqual([
        "decisions.source",
        "decisions.tier",
        "decisions.model",
        "tokens.input",
        "tokens.cached",
      ]);
      expect(test.requests[0]?.query.get("mode")).toBe("live");
      expect(test.requests[0]?.query.get("since")).toBe("1788700000");
    }),
  );

  it.effect("maps the snapshot and skips decisions it cannot read", () =>
    Effect.gen(function* () {
      const api = yield* fixture().api;
      const snapshot = yield* api.snapshot(config);
      expect(snapshot.decisions).toEqual([
        {
          threadId: "thread-a",
          requestId: "req-1",
          at: "2026-09-06T15:00:10.500Z",
          model: "sol",
          label: "Sol",
          tier: 2,
          kind: "extraction",
          confidence: 0.92,
          source: "jev",
          turn: "continuation",
          downgraded: true,
          advice: "compact",
          reasons: ["jev extraction 0.92", "affinity kept"],
        },
        {
          threadId: "thread-b",
          requestId: "req-2",
          at: "2026-09-06T15:01:40.000Z",
          model: "astra",
          label: "astra",
          tier: 3,
          kind: "planning",
          confidence: 0.6,
          source: "fallback",
          turn: "user",
          downgraded: false,
          advice: null,
          reasons: [],
        },
      ]);
      expect(snapshot.windows).toEqual([
        {
          id: "openai|a@example.com|weekly",
          provider: "openai",
          account: "a@example.com",
          label: "weekly",
          remainingFraction: 0.42,
          observedAt: "2026-09-06T14:46:40.000Z",
          resetsAt: "2026-09-10T00:26:40.000Z",
        },
      ]);
      expect(snapshot.alerts).toEqual([
        { at: "2026-09-06T15:00:20.000Z", title: "weekly (a@example.com): 42% left" },
      ]);
      expect(snapshot.usage).toEqual([
        { id: "jev_calls", label: "jev classifier calls", used: 150, threshold: 1000 },
      ]);
    }),
  );

  it.effect("fails with a bounded detail and never the router's body", () =>
    Effect.gen(function* () {
      const api = yield* fixture(() => Response.json({ detail: "do-not-publish" }, { status: 503 }))
        .api;
      const result = yield* api.snapshot(config).pipe(Effect.result);
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure.detail).toBe("The router request failed.");
        const leaked = Object.values(result.failure).some((value) =>
          String(value).includes("do-not-publish"),
        );
        expect(leaked).toBe(false);
      }
    }),
  );
});
