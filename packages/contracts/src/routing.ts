/**
 * Routing contract.
 *
 * A Pistache router sits in front of the models an OpenCode `pistache`
 * provider instance uses and decides, per request, which model and tier run
 * it. This contract carries what the router reports back: hourly rollups for
 * the Routing page, and the per-thread decisions the chat composer shows as a
 * badge. The server keeps the router's credentials; clients only see these
 * shapes.
 *
 * @module routing
 */
import * as Schema from "effect/Schema";

import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * One hourly rollup cell. `hour` is the start of the hour in epoch seconds.
 * `series` names what was counted and `label` which bucket of it, e.g.
 * series `decisions.tier` with label `3`.
 */
export const RoutingMetricRow = Schema.Struct({
  hour: Schema.Number,
  series: Schema.String,
  label: Schema.String,
  value: Schema.Number,
});
export type RoutingMetricRow = typeof RoutingMetricRow.Type;

/** A provider subscription window the router watches. Fractions are 0..1. */
export const RoutingWindow = Schema.Struct({
  id: Schema.String,
  provider: Schema.String,
  account: Schema.String,
  label: Schema.String,
  remainingFraction: Schema.Number,
  observedAt: Schema.String,
  resetsAt: Schema.String,
});
export type RoutingWindow = typeof RoutingWindow.Type;

export const RoutingAlert = Schema.Struct({
  at: Schema.String,
  title: Schema.String,
});
export type RoutingAlert = typeof RoutingAlert.Type;

/** An operator counter with the threshold it alerts at, if one is set. */
export const RoutingUsageCounter = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  used: Schema.Number,
  threshold: Schema.NullOr(Schema.Number),
});
export type RoutingUsageCounter = typeof RoutingUsageCounter.Type;

/**
 * Everything the Routing page needs from one environment's router.
 *
 * `configured` is false when the environment has no `pistache` provider
 * instance with a base URL and API key; the other fields are then empty.
 * `error` is set when the router is configured but could not be read.
 */
export const RoutingOverview = Schema.Struct({
  configured: Schema.Boolean,
  fetchedAt: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  rows: Schema.Array(RoutingMetricRow),
  windows: Schema.Array(RoutingWindow),
  alerts: Schema.Array(RoutingAlert),
  usage: Schema.Array(RoutingUsageCounter),
});
export type RoutingOverview = typeof RoutingOverview.Type;

export const RoutingAdvice = Schema.Literals(["compact", "handoff"]);
export type RoutingAdvice = typeof RoutingAdvice.Type;

/** One routing decision the router made for a request on a thread. */
export const RoutingDecision = Schema.Struct({
  requestId: Schema.String,
  at: Schema.String,
  model: Schema.String,
  label: Schema.String,
  tier: Schema.Number,
  /** The task kind the classifier assigned, e.g. `extraction`. */
  kind: Schema.String,
  confidence: Schema.Number,
  /** Who classified: `caller`, `jev`, `fallback`, `heuristic`, ... */
  source: Schema.String,
  /** `user` for a fresh prompt, `continuation` for an agent loop after tool output. */
  turn: Schema.String,
  downgraded: Schema.Boolean,
  advice: Schema.NullOr(RoutingAdvice),
  reasons: Schema.Array(Schema.String),
});
export type RoutingDecision = typeof RoutingDecision.Type;

/** Decisions for one T3 thread, newest first. */
export const RoutingThreadHistory = Schema.Struct({
  configured: Schema.Boolean,
  threadId: ThreadId,
  decisions: Schema.Array(RoutingDecision),
});
export type RoutingThreadHistory = typeof RoutingThreadHistory.Type;

export const RoutingThreadHistoryInput = Schema.Struct({ threadId: ThreadId });
export type RoutingThreadHistoryInput = typeof RoutingThreadHistoryInput.Type;

export class RoutingSourceError extends Schema.TaggedError<RoutingSourceError>()(
  "RoutingSourceError",
  {
    /** Stable, bounded description. Never the router's response body. */
    detail: TrimmedNonEmptyString,
  },
) {
  override get message(): string {
    return this.detail;
  }
}
