/**
 * Typed reads against a Pistache router's HTTP API.
 *
 * Two endpoints feed everything the clients show: `/api/v1/metrics` for the
 * hourly rollups and `/api/v1/snapshot` for live state (subscription windows,
 * alerts, operator counters, and every decision, which is where per-thread
 * history comes from). Only `mode=live` is read; shadow and demo traffic are
 * the router's own concern.
 *
 * @module routing/pistacheApi
 */
import {
  ForwardCompatibleArray,
  RoutingSourceError,
  type RoutingAlert,
  type RoutingDecision,
  type RoutingMetricRow,
  type RoutingUsageCounter,
  type RoutingWindow,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

export interface PistacheConfig {
  /** Router origin, without the `/v1` the OpenAI-compatible gateway lives under. */
  readonly baseUrl: string;
  readonly token: string;
}

/**
 * The rollup series the Routing page reads. Anything else the router adds
 * later is dropped here so the wire payload stays small.
 */
export const ROUTING_METRIC_SERIES: ReadonlySet<string> = new Set([
  "decisions.source",
  "decisions.tier",
  "decisions.model",
  "decisions.downgrade",
  "downgrade.outcome",
  "tokens.input",
  "tokens.cached",
  "window.remaining",
]);

const MetricsResponse = Schema.Struct({
  rows: Schema.Array(
    Schema.Struct({
      hour: Schema.Number,
      series: Schema.String,
      label: Schema.String,
      value: Schema.Number,
    }),
  ),
});

const SnapshotDecision = Schema.Struct({
  request_id: Schema.String,
  thread_id: Schema.String,
  at: Schema.Number,
  model: Schema.String,
  label: Schema.optional(Schema.String),
  tier: Schema.Number,
  signals: Schema.Struct({
    task_type: Schema.optional(Schema.String),
    confidence: Schema.optional(Schema.Number),
    source: Schema.optional(Schema.String),
    turn: Schema.optional(Schema.String),
  }),
  reasons: Schema.optional(Schema.Array(Schema.String)),
  downgraded: Schema.optional(Schema.Boolean),
  advice: Schema.optional(Schema.NullOr(Schema.String)),
});
type SnapshotDecision = typeof SnapshotDecision.Type;

const SnapshotWindow = Schema.Struct({
  id: Schema.String,
  provider: Schema.String,
  account: Schema.String,
  label: Schema.String,
  remaining_fraction: Schema.Number,
  observed_at: Schema.Number,
  resets_at: Schema.Number,
});

const SnapshotEvent = Schema.Struct({
  kind: Schema.String,
  at: Schema.Number,
  title: Schema.String,
});

const SnapshotUsage = Schema.Struct({
  id: Schema.String,
  used: Schema.Number,
  threshold: Schema.optional(Schema.NullOr(Schema.Number)),
  label: Schema.optional(Schema.NullOr(Schema.String)),
});

// Each list drops elements it cannot read instead of failing the whole
// snapshot: a router one release ahead must not blank the page.
const tolerant = <Element extends Schema.Top>(element: Element) =>
  Schema.optional(ForwardCompatibleArray(element));

const SnapshotResponse = Schema.Struct({
  decisions: tolerant(SnapshotDecision),
  subscription_windows: tolerant(SnapshotWindow),
  events: tolerant(SnapshotEvent),
  usage: tolerant(SnapshotUsage),
});

const decodeMetrics = Schema.decodeUnknownEffect(MetricsResponse);
const decodeSnapshot = Schema.decodeUnknownEffect(SnapshotResponse);

export interface PistacheSnapshot {
  readonly decisions: ReadonlyArray<RoutingDecision & { readonly threadId: string }>;
  readonly windows: ReadonlyArray<RoutingWindow>;
  readonly alerts: ReadonlyArray<RoutingAlert>;
  readonly usage: ReadonlyArray<RoutingUsageCounter>;
}

const toIso = (epochSeconds: number) =>
  DateTime.formatIso(DateTime.makeUnsafe(Math.round(epochSeconds * 1000)));

export function toRoutingDecision(
  decision: SnapshotDecision,
): RoutingDecision & { readonly threadId: string } {
  const advice = decision.advice;
  return {
    threadId: decision.thread_id,
    requestId: decision.request_id,
    at: toIso(decision.at),
    model: decision.model,
    label: decision.label ?? decision.model,
    tier: decision.tier,
    kind: decision.signals.task_type ?? "unknown",
    confidence: decision.signals.confidence ?? 0,
    source: decision.signals.source ?? "caller",
    turn: decision.signals.turn ?? "user",
    downgraded: decision.downgraded ?? false,
    advice: advice === "compact" || advice === "handoff" ? advice : null,
    reasons: decision.reasons ?? [],
  };
}

export const makePistacheApi = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;

  const get = Effect.fn("PistacheApi.get")(function* (
    config: PistacheConfig,
    path: string,
    query: Readonly<Record<string, string>>,
  ) {
    const url = yield* Effect.try({
      try: () => {
        const target = new URL(path, config.baseUrl);
        for (const [key, value] of Object.entries(query)) target.searchParams.set(key, value);
        return target.toString();
      },
      catch: () => new RoutingSourceError({ detail: "The router URL is not valid." }),
    });
    return yield* client
      .execute(
        HttpClientRequest.get(url).pipe(
          HttpClientRequest.setHeader("Authorization", `Bearer ${config.token}`),
        ),
      )
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap((response) => response.json),
        Effect.timeout("15 seconds"),
        Effect.mapError(() => new RoutingSourceError({ detail: "The router request failed." })),
      );
  });

  const metrics = Effect.fn("PistacheApi.metrics")(function* (
    config: PistacheConfig,
    sinceEpochSeconds: number,
  ): Effect.fn.Return<ReadonlyArray<RoutingMetricRow>, RoutingSourceError> {
    const raw = yield* get(config, "/api/v1/metrics", {
      mode: "live",
      since: String(Math.floor(sinceEpochSeconds)),
    });
    const response = yield* decodeMetrics(raw).pipe(
      Effect.mapError(
        () => new RoutingSourceError({ detail: "The router returned unreadable metrics." }),
      ),
    );
    return response.rows.filter((row) => ROUTING_METRIC_SERIES.has(row.series));
  });

  const snapshot = Effect.fn("PistacheApi.snapshot")(function* (
    config: PistacheConfig,
  ): Effect.fn.Return<PistacheSnapshot, RoutingSourceError> {
    const raw = yield* get(config, "/api/v1/snapshot", { mode: "live" });
    const response = yield* decodeSnapshot(raw).pipe(
      Effect.mapError(
        () => new RoutingSourceError({ detail: "The router returned an unreadable snapshot." }),
      ),
    );
    return {
      decisions: (response.decisions ?? []).map(toRoutingDecision),
      windows: (response.subscription_windows ?? []).map((window) => ({
        id: window.id,
        provider: window.provider,
        account: window.account,
        label: window.label,
        remainingFraction: window.remaining_fraction,
        observedAt: toIso(window.observed_at),
        resetsAt: toIso(window.resets_at),
      })),
      alerts: (response.events ?? [])
        .filter((event) => event.kind === "alert")
        .map((event) => ({ at: toIso(event.at), title: event.title })),
      usage: (response.usage ?? []).map((counter) => ({
        id: counter.id,
        label: counter.label ?? counter.id,
        used: counter.used,
        threshold: counter.threshold ?? null,
      })),
    };
  });

  return { metrics, snapshot };
});
