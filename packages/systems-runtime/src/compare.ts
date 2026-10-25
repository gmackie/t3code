import type { ExpectedTraceDocument } from "@t3tools/systems-model/documents";
import { compare, format, type RationalTime } from "@t3tools/systems-model/rational";
import type { RunOutcome, SignalSample, TraceEvent } from "@t3tools/systems-model/trace";

/**
 * Compare a run against an expected trace (RFC-001 §14). Observations are post-side
 * (`t⁺`) values: committed signals after Phase E, each chart's active leaf after
 * settling and the transitions fired at that time. Every mismatch names its entity and time.
 */

export interface Mismatch {
  readonly kind: "status" | "signal" | "activeState" | "firedTransitions" | "transition";
  readonly message: string;
  readonly time?: RationalTime;
  readonly entityId?: string;
  readonly expected?: unknown;
  readonly actual?: unknown;
  /** `actual - expected` for numeric signals. */
  readonly delta?: number;
}

const sameTime = (time: RationalTime) => (event: { readonly time: RationalTime }) =>
  compare(event.time, time) === 0;

/** The probe value observable at `time`: the boundary's post side, else the initial value. */
const observed = (samples: ReadonlyArray<SignalSample>, signalId: string, time: RationalTime) => {
  const at = samples.filter((sample) => sample.signalId === signalId && sameTime(time)(sample));
  return at.findLast((sample) => sample.side === "post") ?? at.find((s) => s.side === "initial");
};

/** Active leaf of each chart instance at `time`; entry always descends to a leaf. */
const activeLeaves = (trace: ReadonlyArray<TraceEvent>, time: RationalTime) => {
  const leaves = new Map<string, string>();
  for (const event of trace)
    if (event.kind === "state.enter" && compare(event.time, time) <= 0)
      leaves.set(event.correlationId ?? "", event.entityId ?? "");
  return [...leaves.values()];
};

export const compareToExpected = (
  outcome: RunOutcome,
  expected: ExpectedTraceDocument,
): ReadonlyArray<Mismatch> => {
  const mismatches: Array<Mismatch> = [];
  const tolerance = expected.numericAbsTolerance;
  if (outcome.status !== "completed")
    mismatches.push({
      kind: "status",
      message: `run ${outcome.status} at t=${format(outcome.lastCommittedTime)}: ${outcome.diagnostics
        .map((diagnostic) => `${diagnostic.code} ${diagnostic.message}`)
        .join("; ")}`,
      time: outcome.lastCommittedTime,
      expected: "completed",
      actual: outcome.status,
    });
  const fired = outcome.trace.filter((event) => event.kind === "transition.fire");
  // A stopped run is only judged on the boundaries it committed; its status is reported.
  const reached = (time: RationalTime) =>
    outcome.status === "completed" ||
    (outcome.samples.length > 0 && compare(time, outcome.lastCommittedTime) <= 0);

  for (const observation of expected.observations.filter((o) => reached(o.time))) {
    const time = observation.time;
    const when = `t=${format(time)}`;
    for (const [signalId, want] of Object.entries(observation.signals).toSorted(([a], [b]) =>
      a < b ? -1 : 1,
    )) {
      const sample = observed(outcome.samples, signalId, time);
      const base = { kind: "signal", time, entityId: signalId, expected: want.value } as const;
      if (sample === undefined) {
        mismatches.push({ ...base, message: `${when}: ${signalId} has no sample at this time` });
        continue;
      }
      if (sample.unit !== want.unit)
        mismatches.push({
          ...base,
          expected: want.unit,
          actual: sample.unit,
          message: `${when}: ${signalId} is in ${sample.unit}, expected ${want.unit}`,
        });
      if (typeof want.value === "number" && typeof sample.value === "number") {
        const delta = sample.value - want.value;
        if (!(Math.abs(delta) <= tolerance))
          mismatches.push({
            ...base,
            actual: sample.value,
            delta,
            message: `${when}: ${signalId} = ${sample.value}, expected ${want.value} (delta ${delta}, tolerance ${tolerance})`,
          });
      } else if (sample.value !== want.value)
        mismatches.push({
          ...base,
          actual: sample.value,
          message: `${when}: ${signalId} = ${sample.value}, expected ${want.value}`,
        });
    }

    if (observation.activeState !== undefined) {
      const leaves = activeLeaves(outcome.trace, time);
      if (!leaves.includes(observation.activeState))
        mismatches.push({
          kind: "activeState",
          time,
          entityId: observation.activeState,
          expected: observation.activeState,
          actual: leaves,
          message: `${when}: active state ${leaves.join(", ") || "none"}, expected ${observation.activeState}`,
        });
    }

    const ids = fired.filter(sameTime(time)).map((event) => event.entityId);
    if (ids.join() !== observation.firedTransitions.join())
      mismatches.push({
        kind: "firedTransitions",
        time,
        expected: observation.firedTransitions,
        actual: ids,
        message: `${when}: fired [${ids.join(", ")}], expected [${observation.firedTransitions.join(", ")}]`,
      });
  }

  const matched = new Set<TraceEvent>();
  for (const transition of expected.expectedTransitions.filter((t) => reached(t.time))) {
    const when = `t=${format(transition.time)}`;
    const fire = fired.find(
      (event) =>
        !matched.has(event) &&
        event.entityId === transition.transitionId &&
        sameTime(transition.time)(event),
    );
    if (fire === undefined) {
      mismatches.push({
        kind: "transition",
        time: transition.time,
        entityId: transition.transitionId,
        message: `${when}: ${transition.transitionId} did not fire`,
      });
      continue;
    }
    matched.add(fire);
    for (const [list, kind] of [
      ["exit", "state.exit"],
      ["enter", "state.enter"],
    ] as const) {
      const wanted = transition[list];
      if (wanted === undefined) continue;
      const actual = outcome.trace
        .filter(
          (event) =>
            event.kind === kind &&
            event.microstep === fire.microstep &&
            event.correlationId === fire.correlationId &&
            sameTime(transition.time)(event),
        )
        .map((event) => event.entityId);
      if (actual.join() !== wanted.join())
        mismatches.push({
          kind: "transition",
          time: transition.time,
          entityId: transition.transitionId,
          expected: wanted,
          actual,
          message: `${when}: ${transition.transitionId} ${list} [${actual.join(", ")}], expected [${wanted.join(", ")}]`,
        });
    }
  }
  return mismatches;
};
