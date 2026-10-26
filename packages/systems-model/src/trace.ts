import * as Schema from "effect/Schema";

import { ModelDiagnostic } from "./diagnostics.ts";
import { RationalTime } from "./rational.ts";

/**
 * RFC-001 §11.2 trace vocabulary, shared by the chart interpreter and the scheduler.
 * Order is `sequence`, never insertion time; high-volume signals are separate samples.
 */

export const TracePhase = Schema.Literals([
  "initialize",
  "input",
  "event",
  "clock",
  "post",
  "solver",
  "final",
]);
export type TracePhase = typeof TracePhase.Type;

export const TraceKind = Schema.Literals([
  "state.enter",
  "state.exit",
  "transition.fire",
  "event.emit",
  "event.consume",
  "event.ignored",
  "signal.sample",
  "signal.commit",
  "solver.step",
  "diagnostic",
  "run.finish",
]);
export type TraceKind = typeof TraceKind.Type;

export const TraceEvent = Schema.Struct({
  runId: Schema.String,
  /** Unsigned decimal integer, so long runs never lose order to float rounding. */
  sequence: Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]*)$/)),
  time: RationalTime,
  microstep: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  phase: TracePhase,
  kind: TraceKind,
  entityId: Schema.optionalKey(Schema.String),
  correlationId: Schema.optionalKey(Schema.String),
  payload: Schema.optionalKey(Schema.Unknown),
});
export type TraceEvent = typeof TraceEvent.Type;

export const SignalValue = Schema.Union([Schema.Number, Schema.Boolean]);
export type SignalValue = typeof SignalValue.Type;

/** One probe reading at an exact boundary; `side` separates `t⁻` from `t⁺` when they differ. */
export const SignalSample = Schema.Struct({
  signalId: Schema.String,
  time: RationalTime,
  side: Schema.Literals(["initial", "pre", "post"]),
  value: SignalValue,
  unit: Schema.String,
});
export type SignalSample = typeof SignalSample.Type;

export const RunStatus = Schema.Literals(["completed", "failed", "cancelled"]);
export type RunStatus = typeof RunStatus.Type;

/** Everything a finished simulation produced; immutable once returned. */
export const RunOutcome = Schema.Struct({
  status: RunStatus,
  /** Last boundary whose effects were fully committed. */
  lastCommittedTime: RationalTime,
  trace: Schema.Array(TraceEvent),
  samples: Schema.Array(SignalSample),
  diagnostics: Schema.Array(ModelDiagnostic),
});
export type RunOutcome = typeof RunOutcome.Type;
