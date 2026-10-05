import { describe, expect, it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type HostPowerSnapshot,
  type ProviderInstanceConfig,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import * as BackgroundPolicy from "../background/BackgroundPolicy.ts";
import * as HostPowerMonitor from "../background/HostPowerMonitor.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as PistacheSource from "./PistacheSource.ts";
import { metricsFixture, snapshotFixture } from "./pistacheApi.fixture.ts";

const hostPower: HostPowerSnapshot = {
  source: "unknown",
  idle: "unknown",
  idleSeconds: null,
  locked: "unknown",
  suspended: false,
  onBattery: "unknown",
  lowPowerMode: "unknown",
  thermalState: "unknown",
  stale: true,
  updatedAt: DateTime.makeUnsafe("2026-09-05T20:30:00.000Z"),
};

const hostPowerLayer = Layer.effect(
  HostPowerMonitor.HostPowerMonitor,
  Effect.gen(function* () {
    const changes = yield* PubSub.sliding<HostPowerSnapshot>(1);
    return HostPowerMonitor.HostPowerMonitor.of({
      snapshot: Effect.succeed(hostPower),
      report: (next) => PubSub.publish(changes, next).pipe(Effect.asVoid),
      streamChanges: Stream.fromPubSub(changes),
    });
  }),
);

const V1_CONFIG = JSON.stringify({
  provider: {
    pistache: {
      npm: "@ai-sdk/openai-compatible",
      options: { baseURL: "http://router.test:8080/v1" },
    },
  },
});
const V2_CONFIG = JSON.stringify({
  providers: { pistache: { settings: { baseURL: "http://router.test:8080/v1/" } } },
});

function instance(
  environment: ReadonlyArray<{ name: string; value: string; sensitive?: boolean }>,
): ProviderInstanceConfig {
  return {
    driver: ProviderDriverKind.make("opencode"),
    environment: environment.map((variable) => ({
      name: variable.name,
      value: variable.value,
      sensitive: variable.sensitive ?? false,
    })),
  };
}

function harness(instances: Record<string, ProviderInstanceConfig>) {
  const requests: string[] = [];
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      const url = new URL(request.url);
      requests.push(url.origin + url.pathname);
      return HttpClientResponse.fromWeb(
        request,
        Response.json(url.pathname === "/api/v1/metrics" ? metricsFixture : snapshotFixture),
      );
    }),
  );
  const settings = ServerSettings.layerTest({ providerInstances: instances });
  const layer = PistacheSource.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(HttpClient.HttpClient, http),
        settings,
        BackgroundPolicy.layer.pipe(Layer.provide(Layer.merge(hostPowerLayer, settings))),
      ),
    ),
  );
  return { requests, layer };
}

const configured = (
  environment: ReadonlyArray<{ name: string; value: string; sensitive?: boolean }>,
) => ({
  [ProviderInstanceId.make("pistache")]: instance(environment),
});

describe("resolvePistacheConfig", () => {
  const resolve = (instances: Record<string, ProviderInstanceConfig>) =>
    Effect.gen(function* () {
      const settings = yield* ServerSettings.ServerSettingsService;
      return PistacheSource.resolvePistacheConfig(yield* settings.getSettings);
    }).pipe(Effect.provide(ServerSettings.layerTest({ providerInstances: instances })));

  it.effect("derives the origin from an OpenCode 1.x config and strips /v1", () =>
    Effect.gen(function* () {
      const config = yield* resolve(
        configured([
          { name: "OPENCODE_CONFIG_CONTENT", value: V1_CONFIG },
          { name: "PISTACHE_API_KEY", value: "secret", sensitive: true },
        ]),
      );
      expect(config).toEqual({ baseUrl: "http://router.test:8080", token: "secret" });
    }),
  );

  it.effect("derives the origin from an OpenCode 2.x config", () =>
    Effect.gen(function* () {
      const config = yield* resolve(
        configured([
          { name: "OPENCODE_CONFIG_CONTENT", value: V2_CONFIG },
          { name: "PISTACHE_API_KEY", value: "secret", sensitive: true },
        ]),
      );
      expect(config?.baseUrl).toBe("http://router.test:8080");
    }),
  );

  it.effect("prefers an explicit PISTACHE_BASE_URL", () =>
    Effect.gen(function* () {
      const config = yield* resolve(
        configured([
          { name: "OPENCODE_CONFIG_CONTENT", value: V1_CONFIG },
          { name: "PISTACHE_BASE_URL", value: "https://pistache.example/" },
          { name: "PISTACHE_API_KEY", value: "secret", sensitive: true },
        ]),
      );
      expect(config?.baseUrl).toBe("https://pistache.example");
    }),
  );

  it.effect("is null without a key, without a URL, or without the instance", () =>
    Effect.gen(function* () {
      expect(
        yield* resolve(configured([{ name: "OPENCODE_CONFIG_CONTENT", value: V1_CONFIG }])),
      ).toBeNull();
      expect(
        yield* resolve(configured([{ name: "PISTACHE_API_KEY", value: "secret" }])),
      ).toBeNull();
      expect(
        yield* resolve({
          [ProviderInstanceId.make("other")]: instance([
            { name: "PISTACHE_BASE_URL", value: "http://router.test" },
            { name: "PISTACHE_API_KEY", value: "secret" },
          ]),
        }),
      ).toBeNull();
    }),
  );
});

describe("PistacheSource", () => {
  it.effect("reports unconfigured and makes no requests without a pistache instance", () =>
    Effect.gen(function* () {
      const test = harness({});
      const source = yield* PistacheSource.PistacheSource.pipe(Effect.provide(test.layer));
      yield* source.refresh;
      expect(yield* source.overview).toEqual({
        configured: false,
        fetchedAt: null,
        error: null,
        rows: [],
        windows: [],
        alerts: [],
        usage: [],
      });
      expect(yield* source.threadHistory(ThreadId.make("thread-a"))).toMatchObject({
        configured: false,
        decisions: [],
      });
      expect(test.requests).toEqual([]);
    }),
  );

  it.effect("serves the overview and per-thread decisions from one read", () =>
    Effect.gen(function* () {
      const test = harness(
        configured([
          { name: "OPENCODE_CONFIG_CONTENT", value: V1_CONFIG },
          { name: "PISTACHE_API_KEY", value: "secret", sensitive: true },
        ]),
      );
      const source = yield* PistacheSource.PistacheSource.pipe(Effect.provide(test.layer));
      yield* source.refresh;
      const overview = yield* source.overview;
      expect(overview.configured).toBe(true);
      expect(overview.error).toBeNull();
      expect(overview.rows).toHaveLength(5);
      expect(overview.windows[0]?.remainingFraction).toBe(0.42);
      expect(overview.alerts).toHaveLength(1);
      expect(overview.usage[0]?.id).toBe("jev_calls");

      const history = yield* source.threadHistory(ThreadId.make("thread-a"));
      expect(history.configured).toBe(true);
      expect(history.decisions.map((decision) => decision.requestId)).toEqual(["req-1"]);
      expect(history.decisions[0]).not.toHaveProperty("threadId");
      expect(yield* source.threadHistory(ThreadId.make("thread-none"))).toMatchObject({
        decisions: [],
      });
      expect(new Set(test.requests)).toEqual(
        new Set([
          "http://router.test:8080/api/v1/metrics",
          "http://router.test:8080/api/v1/snapshot",
        ]),
      );
    }),
  );
});
