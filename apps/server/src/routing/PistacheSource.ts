/**
 * PistacheSource — what the environment's Pistache router decided and how
 * its subscription windows are doing.
 *
 * The router is configured as the OpenCode provider instance `pistache`.
 * Its base URL and API key come from that instance's environment, so the
 * user configures routing once, in Settings → Providers, and this source
 * follows. The source polls on the provider health-check interval and on
 * every settings change, keeping one overview and the live decision list in
 * memory. Nothing is persisted; like provider status it re-derives on boot.
 *
 * Per-thread history is served from the cached decision list rather than the
 * router's `/threads/{id}/history` endpoint, which only carries event titles.
 *
 * @module routing/PistacheSource
 */
import {
  DEFAULT_PROVIDER_HEALTH_REFRESH_INTERVAL,
  ProviderInstanceId,
  type ProviderInstanceConfig,
  type RoutingDecision,
  type RoutingOverview,
  type RoutingThreadHistory,
  type ServerSettings,
  type ThreadId,
} from "@t3tools/contracts";
import { resolveServerBackgroundActivitySettings } from "@t3tools/shared/backgroundActivitySettings";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import * as BackgroundPolicy from "../background/BackgroundPolicy.ts";
import * as Settings from "../serverSettings.ts";
import { makePistacheApi, type PistacheConfig, type PistacheSnapshot } from "./pistacheApi.ts";

export const PISTACHE_INSTANCE_ID = ProviderInstanceId.make("pistache");
/** Rollups older than this are not shown; the page offers 24h and 7d views. */
const METRICS_WINDOW_SECONDS = 7 * 24 * 3600;

export class PistacheSource extends Context.Service<
  PistacheSource,
  {
    readonly overview: Effect.Effect<RoutingOverview>;
    readonly threadHistory: (threadId: ThreadId) => Effect.Effect<RoutingThreadHistory>;
    /** Re-read the router now. Never fails; failures land on the overview. */
    readonly refresh: Effect.Effect<void>;
  }
>()("t3/routing/PistacheSource") {}

function environmentValue(instance: ProviderInstanceConfig, name: string): string | undefined {
  const value = instance.environment?.find((variable) => variable.name === name)?.value;
  return value === undefined || value.length === 0 ? undefined : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads the router origin out of the `OPENCODE_CONFIG_CONTENT` JSON the
 * instance already carries for OpenCode. Both config generations are
 * accepted: OpenCode 1.x keeps `provider.<id>.options.baseURL`, 2.x keeps
 * `providers.<id>.settings.baseURL`.
 */
export function baseUrlFromOpenCodeConfig(content: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const v1 = isRecord(parsed.provider) ? parsed.provider[PISTACHE_INSTANCE_ID] : undefined;
  const v1Options = isRecord(v1) && isRecord(v1.options) ? v1.options.baseURL : undefined;
  const v2 = isRecord(parsed.providers) ? parsed.providers[PISTACHE_INSTANCE_ID] : undefined;
  const v2Settings = isRecord(v2) && isRecord(v2.settings) ? v2.settings.baseURL : undefined;
  const baseURL = typeof v1Options === "string" ? v1Options : v2Settings;
  return typeof baseURL === "string" && baseURL.length > 0 ? baseURL : undefined;
}

/** The gateway lives under `/v1`; the management API is at the origin. */
function stripGatewaySuffix(url: string): string {
  return url.replace(/\/+$/, "").replace(/\/v1$/, "");
}

/**
 * Null when the environment has no `pistache` instance, or it has no API key
 * or discoverable base URL. The source makes no requests in that state.
 */
export function resolvePistacheConfig(settings: ServerSettings): PistacheConfig | null {
  const instance = settings.providerInstances[PISTACHE_INSTANCE_ID];
  if (!instance || instance.enabled === false) return null;
  const token = environmentValue(instance, "PISTACHE_API_KEY");
  if (token === undefined) return null;
  const explicit = environmentValue(instance, "PISTACHE_BASE_URL");
  const configContent = environmentValue(instance, "OPENCODE_CONFIG_CONTENT");
  const derived =
    configContent === undefined ? undefined : baseUrlFromOpenCodeConfig(configContent);
  const baseUrl = explicit ?? derived;
  if (baseUrl === undefined) return null;
  return { baseUrl: stripGatewaySuffix(baseUrl), token };
}

const UNCONFIGURED: RoutingOverview = {
  configured: false,
  fetchedAt: null,
  error: null,
  rows: [],
  windows: [],
  alerts: [],
  usage: [],
};

interface State {
  readonly overview: RoutingOverview;
  readonly decisions: PistacheSnapshot["decisions"];
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const api = yield* makePistacheApi;
  const settingsService = yield* Settings.ServerSettingsService;
  const backgroundPolicy = yield* BackgroundPolicy.BackgroundPolicy;
  const stateRef = yield* Ref.make<State>({ overview: UNCONFIGURED, decisions: [] });

  const read = Effect.fn("PistacheSource.read")(function* (config: PistacheConfig) {
    const now = yield* DateTime.now;
    const fetchedAt = DateTime.formatIso(now);
    const since = DateTime.toEpochMillis(now) / 1000 - METRICS_WINDOW_SECONDS;
    const result = yield* Effect.all(
      { rows: api.metrics(config, since), snapshot: api.snapshot(config) },
      { concurrency: 2 },
    ).pipe(Effect.result);
    if (result._tag === "Failure") {
      yield* Effect.logDebug("pistache read failed", { cause: result.failure });
      const previous = yield* Ref.get(stateRef);
      // Keep the last good data visible with the error beside it.
      return {
        overview: {
          ...previous.overview,
          configured: true,
          fetchedAt,
          error: result.failure.detail,
        },
        decisions: previous.decisions,
      } satisfies State;
    }
    const { rows, snapshot } = result.success;
    return {
      overview: {
        configured: true,
        fetchedAt,
        error: null,
        rows,
        windows: snapshot.windows,
        alerts: snapshot.alerts,
        usage: snapshot.usage,
      },
      decisions: snapshot.decisions,
    } satisfies State;
  });

  // One refresh at a time so a slow read started before a settings change
  // cannot publish after the change's own refresh.
  const refreshLock = yield* Semaphore.make(1);
  const refresh = Effect.gen(function* () {
    const settings = yield* settingsService.getSettings.pipe(
      Effect.orElseSucceed((): ServerSettings | null => null),
    );
    const config = settings === null ? null : resolvePistacheConfig(settings);
    const next = config === null ? { overview: UNCONFIGURED, decisions: [] } : yield* read(config);
    yield* Ref.set(stateRef, next);
  }).pipe(refreshLock.withPermits(1), Effect.ignoreCause({ log: true }));

  yield* settingsService.streamChanges.pipe(
    Stream.map((settings) => settings.providerInstances[PISTACHE_INSTANCE_ID]),
    Stream.changes,
    Stream.runForEach(() => refresh),
    Effect.forkScoped,
  );

  const interval = settingsService.getSettings.pipe(
    Effect.map(
      (settings) => resolveServerBackgroundActivitySettings(settings).providerHealthRefreshInterval,
    ),
    Effect.orElseSucceed(() => DEFAULT_PROVIDER_HEALTH_REFRESH_INTERVAL),
  );
  yield* Effect.forever(
    interval.pipe(
      Effect.flatMap((wait) =>
        Effect.sleep(Duration.toMillis(Duration.fromInputUnsafe(wait)) <= 0 ? "60 seconds" : wait),
      ),
      Effect.andThen(backgroundPolicy.shouldRunScopeWork({ type: "provider-status" })),
      Effect.flatMap((shouldRun) => (shouldRun ? refresh : Effect.void)),
      Effect.ignoreCause({ log: true }),
    ),
  ).pipe(Effect.forkScoped);

  yield* refresh.pipe(Effect.forkScoped);

  const threadHistory = (threadId: ThreadId) =>
    Ref.get(stateRef).pipe(
      Effect.map((state): RoutingThreadHistory => ({
        configured: state.overview.configured,
        threadId,
        decisions: state.decisions
          .filter((decision) => decision.threadId === threadId)
          .map(({ threadId: _threadId, ...decision }): RoutingDecision => decision)
          .toSorted((a, b) => b.at.localeCompare(a.at)),
      })),
    );

  return {
    overview: Ref.get(stateRef).pipe(Effect.map((state) => state.overview)),
    threadHistory,
    refresh,
  } satisfies PistacheSource["Service"];
});

export const layer = Layer.effect(PistacheSource, make);
