import type { ModelDiagnostic } from "@t3tools/systems-model/diagnostics";
import type {
  ChartDocument,
  ExpectedTraceDocument,
  RunDocument,
} from "@t3tools/systems-model/documents";
import { compare, format, type RationalTime } from "@t3tools/systems-model/rational";
import type { RunOutcome, RunStatus, TraceEvent } from "@t3tools/systems-model/trace";

import {
  initialize,
  pendingTimers,
  runToCompletion,
  type ChartState,
  type ChartStep,
  type ChartTrigger,
  type PendingTimer,
  type TraceDraft,
} from "./chart.ts";

/**
 * Chart-only experiment driver: external events and due timers at exact rational
 * times, no clocks or plant. Enough to execute the pure statechart fixtures before
 * the system scheduler exists; the stop time is inclusive.
 */

type RunInput = RunDocument["inputs"][number];

type BoundaryItem =
  | { readonly kind: "event"; readonly input: RunInput }
  | { readonly kind: "timer"; readonly timer: PendingTimer };

type Key = ReadonlyArray<number | string>;

const byKey = (left: Key, right: Key) => {
  for (let index = 0; index < left.length; index++)
    if (left[index] !== right[index]) return left[index]! < right[index]! ? -1 : 1;
  return 0;
};

const inputOrder = (a: RunInput, b: RunInput) =>
  compare(a.time, b.time) ||
  byKey([a.priority, a.sourceId, a.ordinal], [b.priority, b.sourceId, b.ordinal]);

/** Phase C order `(priority, sourceId, sequence)`; a timer's source is its chart. */
const boundaryKey = (item: BoundaryItem): Key =>
  item.kind === "event"
    ? [item.input.priority, item.input.sourceId, 0, item.input.ordinal, 0]
    : [item.timer.priority, item.timer.chartId, 1, item.timer.transitionId, item.timer.generation];

const sameTimer = (a: PendingTimer) => (b: PendingTimer) =>
  a.transitionId === b.transitionId && a.generation === b.generation;

export interface ChartExperimentOptions {
  readonly runId: string;
  readonly microstepLimit?: number;
}

export const runChartExperiment = (
  chart: ChartDocument,
  run: RunDocument,
  options: ChartExperimentOptions,
): RunOutcome => {
  const trace: Array<TraceEvent> = [];
  let sequence = 0n;
  const append = (drafts: ReadonlyArray<TraceDraft>) => {
    for (const draft of drafts)
      trace.push({ runId: options.runId, sequence: String(sequence++), ...draft });
  };
  const ctx = (time: RationalTime, phase: TraceDraft["phase"]) => ({
    time,
    inputs: {},
    phase,
    ...(options.microstepLimit === undefined ? {} : { microstepLimit: options.microstepLimit }),
  });
  const finish = (
    status: RunStatus,
    state: ChartState,
    time: RationalTime,
    lastCommittedTime: RationalTime,
    diagnostic?: ModelDiagnostic,
  ): RunOutcome => {
    const microstep = compare(state.microstep.time, time) === 0 ? state.microstep.index : 0;
    const marker = { time, microstep, entityId: chart.id };
    if (diagnostic !== undefined)
      append([{ ...marker, phase: "event", kind: "diagnostic", payload: diagnostic }]);
    append([{ ...marker, phase: "final", kind: "run.finish", payload: { status } }]);
    return {
      status,
      lastCommittedTime,
      trace,
      samples: [],
      diagnostics: diagnostic === undefined ? [] : [diagnostic],
    };
  };

  const started = initialize(chart, ctx(run.start, "initialize"));
  append(started.trace);
  if (started.diagnostic !== undefined)
    return finish("failed", started.state, run.start, run.start, started.diagnostic);

  const inputs = run.inputs.toSorted(inputOrder);
  let state = started.state;
  let committed = run.start;
  let next = 0;
  for (;;) {
    const timers = pendingTimers(state);
    const candidates = [inputs[next]?.time, timers[0]?.due].filter(
      (time): time is RationalTime => time !== undefined,
    );
    const time = candidates.reduce<RationalTime | undefined>(
      (earliest, candidate) =>
        earliest === undefined || compare(candidate, earliest) < 0 ? candidate : earliest,
      undefined,
    );
    if (time === undefined || compare(time, run.stop) > 0) break;

    const items: Array<BoundaryItem> = timers
      .filter((timer) => compare(timer.due, time) === 0)
      .map((timer) => ({ kind: "timer", timer }));
    while (next < inputs.length && compare(inputs[next]!.time, time) === 0)
      items.push({ kind: "event", input: inputs[next++]! });

    for (const item of items.toSorted((a, b) => byKey(boundaryKey(a), boundaryKey(b)))) {
      // An earlier item at this boundary may have exited the timer's owner.
      if (item.kind === "timer" && !state.timers.some(sameTimer(item.timer))) continue;
      const trigger: ChartTrigger =
        item.kind === "event"
          ? { kind: "event", id: item.input.type }
          : {
              kind: "timer",
              transitionId: item.timer.transitionId,
              generation: item.timer.generation,
            };
      const step: ChartStep = runToCompletion(chart, state, trigger, ctx(time, "event"));
      append(step.trace);
      state = step.state;
      if (step.diagnostic !== undefined)
        return finish("failed", state, time, committed, step.diagnostic);
    }
    committed = time;
  }
  return finish("completed", state, run.stop, run.stop);
};

/**
 * Mismatches between a chart run and the observation fields a chart owns: the active
 * leaf after settling, transitions fired at each time, and exit/enter order.
 * Signal values belong to the system runtime and are not compared here.
 */
export const compareChartTrace = (
  outcome: RunOutcome,
  expected: ExpectedTraceDocument,
): ReadonlyArray<string> => {
  const mismatches: Array<string> = [];
  if (outcome.status !== "completed")
    mismatches.push(`run ${outcome.status}: ${outcome.diagnostics.map((d) => d.code).join(", ")}`);
  const at = (time: RationalTime) => (event: TraceEvent) => compare(event.time, time) === 0;
  const fired = outcome.trace.filter((event) => event.kind === "transition.fire");

  for (const observation of expected.observations) {
    const when = format(observation.time);
    if (observation.activeState !== undefined) {
      // Entry always descends to a leaf, so the latest entered state is the active leaf.
      const leaf = outcome.trace.findLast(
        (event) => event.kind === "state.enter" && compare(event.time, observation.time) <= 0,
      )?.entityId;
      if (leaf !== observation.activeState)
        mismatches.push(`t=${when}: active state ${leaf}, expected ${observation.activeState}`);
    }
    const ids = fired.filter(at(observation.time)).map((event) => event.entityId);
    if (ids.join() !== observation.firedTransitions.join())
      mismatches.push(
        `t=${when}: fired [${ids.join(", ")}], expected [${observation.firedTransitions.join(", ")}]`,
      );
  }

  const matched = new Set<TraceEvent>();
  for (const transition of expected.expectedTransitions) {
    const when = format(transition.time);
    const fire = fired.find(
      (event) =>
        !matched.has(event) &&
        event.entityId === transition.transitionId &&
        at(transition.time)(event),
    );
    if (fire === undefined) {
      mismatches.push(`t=${when}: ${transition.transitionId} did not fire`);
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
            event.kind === kind && event.microstep === fire.microstep && at(transition.time)(event),
        )
        .map((event) => event.entityId);
      if (actual.join() !== wanted.join())
        mismatches.push(
          `t=${when}: ${transition.transitionId} ${list} [${actual.join(", ")}], expected [${wanted.join(", ")}]`,
        );
    }
  }
  return mismatches;
};
