import type {
  ResolvedChart,
  ResolvedNode,
  ResolvedSystem,
} from "@t3tools/systems-compiler/compile";
import type { PortRef, RunDocument } from "@t3tools/systems-model/documents";
import { error, type ModelDiagnostic } from "@t3tools/systems-model/diagnostics";
import {
  add,
  ceil,
  compare,
  divide,
  multiply,
  subtract,
  type RationalTime,
} from "@t3tools/systems-model/rational";
import type {
  RunOutcome,
  RunStatus,
  SignalSample,
  SignalValue,
  TraceEvent,
  TracePhase,
} from "@t3tools/systems-model/trace";
import {
  initialize,
  pendingTimers,
  runToCompletion,
  type ChartState,
  type ChartStep,
  type ChartTrigger,
  type PendingTimer,
  type TraceDraft,
} from "@t3tools/systems-statechart/chart";
import { runChartExperiment } from "@t3tools/systems-statechart/experiment";

import { evaluatePure, initialValue, nonFinite, RunFault } from "./blocks.ts";
import {
  checkRequirements,
  isResolvedSystem,
  requirementsOf,
  RUNTIME_VERSION,
} from "./capabilities.ts";
import { integrate, type OdeProblem } from "./solvers.ts";

/**
 * The RFC-001 §6.2/§6.4 scheduler. A run is a pure, synchronous state machine stepped
 * in bounded chunks of boundaries, so a host can report progress and cancel between
 * chunks; nothing here reads clocks, randomness or I/O.
 */

export interface SimulationOptions {
  readonly runId: string;
  /** Chart microsteps per physical time; defaults to the interpreter's 1024. */
  readonly microstepLimit?: number;
  /** Run-wide bound on solver steps, accepted or rejected; beyond it is `E-NUM-002`. */
  readonly maxSolverSteps?: number;
}

export type SimulationProgress =
  | {
      readonly done: false;
      /** Last fully committed boundary. */
      readonly time: RationalTime;
      readonly boundaries: number;
    }
  | { readonly done: true; readonly outcome: RunOutcome };

export interface Simulation {
  readonly runId: string;
  /** Process at most `maxBoundaries` boundaries; returns the outcome once finished. */
  readonly step: (maxBoundaries: number) => SimulationProgress;
  /** Stop between chunks: status `cancelled` with the trace so far. Idempotent. */
  readonly cancel: () => RunOutcome;
}

export const DEFAULT_MAX_SOLVER_STEPS = 1_000_000;

/** Ordered trace with run-assigned sequence numbers, plus probe samples. */
const recorder = (runId: string) => {
  const trace: Array<TraceEvent> = [];
  const samples: Array<SignalSample> = [];
  let sequence = 0n;
  return {
    trace,
    samples,
    append: (drafts: ReadonlyArray<TraceDraft>, correlationId?: string) => {
      for (const draft of drafts)
        trace.push({
          runId,
          sequence: String(sequence++),
          ...draft,
          ...(correlationId === undefined || draft.correlationId !== undefined
            ? {}
            : { correlationId }),
        });
    },
  };
};

type Recorder = ReturnType<typeof recorder>;

const outcome = (
  recorded: Recorder,
  status: RunStatus,
  time: RationalTime,
  lastCommittedTime: RationalTime,
  diagnostics: ReadonlyArray<ModelDiagnostic>,
  phase: TracePhase,
  entityId: string,
  finish: Readonly<Record<string, unknown>>,
): RunOutcome => {
  recorded.append(
    diagnostics.map((diagnostic) => ({
      time,
      microstep: 0,
      phase,
      kind: "diagnostic",
      entityId: diagnostic.elementId ?? entityId,
      payload: diagnostic,
    })),
  );
  recorded.append([
    {
      time,
      microstep: 0,
      phase: "final",
      kind: "run.finish",
      entityId,
      payload: { status, ...finish },
    },
  ]);
  return {
    status,
    lastCommittedTime,
    trace: recorded.trace,
    samples: recorded.samples,
    diagnostics,
  };
};

/** Diagnostics that prevent a run from starting, before any model code executes. */
const preflight = (
  resolved: ResolvedSystem | ResolvedChart,
  run: RunDocument,
): ReadonlyArray<ModelDiagnostic> => {
  const diagnostics = [...checkRequirements(requirementsOf(resolved, run))];
  const ref = isResolvedSystem(resolved) ? run.modelRef : run.chartRef;
  const own = isResolvedSystem(resolved) ? resolved.entry : resolved.chartRef;
  if (ref !== own)
    diagnostics.push(
      error("E-REF-001", `Run ${run.id} targets ${ref ?? "nothing"}, not ${own}`, {
        elementId: run.id,
      }),
    );
  if (isResolvedSystem(resolved)) {
    const declared = new Set(
      Object.values(resolved.charts).flatMap((chart) =>
        chart.chart.interface.events.map((event) => event.id),
      ),
    );
    run.inputs.forEach((input, index) => {
      if (!declared.has(input.type))
        diagnostics.push(
          error("E-REF-001", `No chart in ${resolved.systemId} declares event "${input.type}"`, {
            elementId: run.id,
            pointer: `/inputs/${index}/type`,
          }),
        );
    });
    for (const output of resolved.outputs)
      if (output.valueType === "string")
        diagnostics.push(
          error("E-TARGET-001", `Output "${output.id}" is a string and cannot be probed`, {
            elementId: output.id,
          }),
        );
  }
  return diagnostics;
};

const refused = (
  runId: string,
  run: RunDocument,
  entityId: string,
  diagnostics: ReadonlyArray<ModelDiagnostic>,
): Simulation => {
  const result = outcome(
    recorder(runId),
    "failed",
    run.start,
    run.start,
    diagnostics,
    "initialize",
    entityId,
    { solver: run.solver.method, runtime: RUNTIME_VERSION },
  );
  return { runId, step: () => ({ done: true, outcome: result }), cancel: () => result };
};

/** Start a run of a compiled system or chart. Nothing executes until `step`. */
export const createSimulation = (
  resolved: ResolvedSystem | ResolvedChart,
  run: RunDocument,
  options: SimulationOptions,
): Simulation => {
  const entityId = isResolvedSystem(resolved) ? resolved.systemId : resolved.chart.id;
  const problems = preflight(resolved, run);
  if (problems.length > 0) return refused(options.runId, run, entityId, problems);
  return isResolvedSystem(resolved)
    ? systemSimulation(resolved, run, options)
    : chartSimulation(resolved, run, options);
};

/** Run to completion in one call. */
export const simulate = (
  resolved: ResolvedSystem | ResolvedChart,
  run: RunDocument,
  options: SimulationOptions,
): RunOutcome => {
  const progress = createSimulation(resolved, run, options).step(Number.POSITIVE_INFINITY);
  if (!progress.done) throw new Error("An unbounded step always finishes the run");
  return progress.outcome;
};

/** Chart-only runs share systems-statechart's driver, so the two cannot drift apart. */
const chartSimulation = (
  resolved: ResolvedChart,
  run: RunDocument,
  options: SimulationOptions,
): Simulation => {
  let result: RunOutcome | undefined;
  return {
    runId: options.runId,
    step: () => {
      result ??= runChartExperiment(resolved.chart, run, {
        runId: options.runId,
        ...(options.microstepLimit === undefined ? {} : { microstepLimit: options.microstepLimit }),
      });
      return { done: true, outcome: result };
    },
    cancel: () =>
      (result ??= outcome(
        recorder(options.runId),
        "cancelled",
        run.start,
        run.start,
        [],
        "final",
        resolved.chart.id,
        {},
      )),
  };
};

// System runs

type RunInput = RunDocument["inputs"][number];
type Key = ReadonlyArray<number | string>;

const byKey = (left: Key, right: Key) => {
  for (let index = 0; index < left.length; index++)
    if (left[index] !== right[index]) return left[index]! < right[index]! ? -1 : 1;
  return 0;
};

const inputOrder = (a: RunInput, b: RunInput) =>
  compare(a.time, b.time) ||
  byKey([a.priority, a.sourceId, a.ordinal], [b.priority, b.sourceId, b.ordinal]);

type BoundaryItem =
  | { readonly kind: "event"; readonly node: string; readonly input: RunInput }
  | { readonly kind: "timer"; readonly node: string; readonly timer: PendingTimer };

/** Phase C order `(priority, source, sequence)`; a timer's source is its chart node. */
const boundaryKey = (item: BoundaryItem): Key =>
  item.kind === "event"
    ? [item.input.priority, item.input.sourceId, 0, item.input.ordinal, item.node]
    : [item.timer.priority, item.node, 1, item.timer.transitionId, item.timer.generation];

/** Values computed in one evaluation context. */
interface Env {
  /** Integrator states by node id. */
  readonly x: ReadonlyMap<string, number>;
  /** Continuous and constant pure nodes, evaluated in `continuousOrder`. */
  readonly values: ReadonlyMap<string, SignalValue>;
  /** Values produced earlier in the current clock tick, not yet committed. */
  readonly overlay?: ReadonlyMap<string, SignalValue>;
}

const systemSimulation = (
  resolved: ResolvedSystem,
  run: RunDocument,
  options: SimulationOptions,
): Simulation => {
  const recorded = recorder(options.runId);
  const nodes = resolved.nodes;
  const node = (id: string): ResolvedNode => nodes[id]!;
  const ofType = (type: string) =>
    Object.values(nodes)
      .filter((candidate) => candidate.type === type)
      .map((candidate) => candidate.id)
      .toSorted();
  const integrators = ofType("std.integrator@1");
  const chartNodes = Object.keys(resolved.charts).toSorted();
  const scheduled = new Set(
    Object.values(resolved.clockSchedules).flatMap((steps) =>
      steps.filter((step) => step.action === "chart").map((step) => step.node),
    ),
  );
  const inputs = run.inputs.toSorted(inputOrder);
  const chartCtx = (
    time: RationalTime,
    phase: TracePhase,
    values: Record<string, SignalValue>,
  ) => ({
    time,
    inputs: values,
    phase,
    ...(options.microstepLimit === undefined ? {} : { microstepLimit: options.microstepLimit }),
  });

  // Model state. Clocked outputs are committed per partition; holds publish in Phase E.
  const x = new Map(integrators.map((id) => [id, node(id).parameters.initial as number]));
  const holds = new Map<string, SignalValue>();
  const registers = new Map<string, SignalValue>();
  const charts = new Map<string, ChartState>();
  const ticks = new Map(
    resolved.clocks.map((clock) => {
      const first = ceil(divide(subtract(run.start, clock.offset), clock.period));
      return [clock.id, first > 0n ? first : 0n] as const;
    }),
  );
  const tickTime = (clockId: string) => {
    const clock = resolved.clocks.find((candidate) => candidate.id === clockId)!;
    return add(clock.offset, multiply(clock.period, ticks.get(clockId)!));
  };
  let nextInput = 0;
  let time = run.start;
  let committed = run.start;
  let phase: TracePhase = "initialize";
  let boundaries = 0;
  let started = false;
  let result: RunOutcome | undefined;

  const read = (ref: PortRef, env: Env): SignalValue | undefined => {
    const source = node(ref.node);
    switch (source.type) {
      case "std.integrator@1":
        return env.x.get(source.id);
      case "std.hold@1":
        return holds.get(source.id);
      case "std.statechart@1": {
        const value = charts.get(source.id)?.outputs[ref.port];
        return typeof value === "string" ? undefined : value;
      }
    }
    if (source.clock === undefined) return env.values.get(source.id);
    return env.overlay?.get(source.id) ?? registers.get(source.id);
  };
  const inputOf = (target: ResolvedNode, port: string, env: Env) =>
    read(target.inputs[port]!.from, env) as SignalValue;
  const pure = (target: ResolvedNode, env: Env) =>
    evaluatePure(target, (port) => inputOf(target, port, env));

  /** Continuous and constant signals for the given integrator states and published holds. */
  const continuous = (states: ReadonlyMap<string, number> = x): Env => {
    const values = new Map<string, SignalValue>();
    const env = { x: states, values };
    for (const id of resolved.continuousOrder)
      if (node(id).type !== "std.integrator@1") values.set(id, pure(node(id), env));
    return env;
  };

  const chartInputs = (chartNode: string, env: Env) => {
    const target = node(chartNode);
    const values: Record<string, SignalValue> = {};
    for (const port of Object.keys(target.inputs).toSorted()) {
      const value = read(target.inputs[port]!.from, env);
      if (value !== undefined) values[port] = value;
    }
    return values;
  };

  const applyChart = (chartNode: string, step: ChartStep) => {
    recorded.append(step.trace, chartNode);
    charts.set(chartNode, step.state);
    if (step.diagnostic !== undefined) throw new RunFault(step.diagnostic);
  };

  const signal = (
    kind: "signal.sample" | "signal.commit",
    entityId: string,
    value: SignalValue | undefined,
    clock: string,
  ) => recorded.append([{ time, microstep: 0, phase, kind, entityId, payload: { value, clock } }]);

  const observe = (side: SignalSample["side"]) => {
    const env = continuous();
    return resolved.outputs.map((output) => ({
      signalId: output.id,
      time,
      side,
      value: read(output.source, env) as SignalValue,
      unit: output.unit,
    }));
  };

  // Initialization (RFC-001 §6.4, §7.6): registers from their initializers, chart roots
  // entered and settled, clocked combinational values computed; no clock ticks yet.
  const initializeModel = () => {
    for (const target of Object.values(nodes)) {
      const initial = initialValue(target);
      if (target.type === "std.hold@1") holds.set(target.id, initial!);
      else if (initial !== undefined) registers.set(target.id, initial);
    }
    const env = continuous();
    for (const chartNode of chartNodes.filter((id) => !scheduled.has(id)))
      applyChart(
        chartNode,
        initialize(
          resolved.charts[chartNode]!.chart,
          chartCtx(time, "initialize", chartInputs(chartNode, env)),
        ),
      );
    for (const clock of resolved.clocks)
      for (const step of resolved.clockSchedules[clock.id] ?? []) {
        const target = node(step.node);
        if (step.action === "chart")
          applyChart(
            target.id,
            initialize(
              resolved.charts[target.id]!.chart,
              chartCtx(time, "initialize", chartInputs(target.id, env)),
            ),
          );
        else if (target.type === "std.sample@1")
          registers.set(target.id, inputOf(target, "value", env));
        else if (step.action === "evaluate") registers.set(target.id, pure(target, env));
      }
    recorded.samples.push(...observe("initial"));
  };

  /** Phase A: integrate the plant over `(time, to]` without crossing `to`. */
  const budget = { remaining: options.maxSolverSteps ?? DEFAULT_MAX_SOLVER_STEPS };
  /** `dx/dt = f(t, x, u_hold)`: continuous graph in `continuousOrder`, holds as published. */
  const plant: OdeProblem = {
    states: integrators,
    derivative: (_t, y) => {
      const env = continuous(new Map(integrators.map((id, index) => [id, y[index]!])));
      return Float64Array.from(integrators, (id) => {
        const value = inputOf(node(id), "derivative", env);
        if (typeof value !== "number" || !Number.isFinite(value))
          throw nonFinite(id, Number(value), "derivative");
        return value;
      });
    },
  };

  /** Phase A: integrate the plant over `(time, to]`, landing exactly on `to`. */
  const advance = (to: RationalTime) => {
    if (integrators.length === 0 || compare(time, to) === 0) return;
    const y0 = Float64Array.from(integrators, (id) => x.get(id)!);
    const advanced = integrate(plant, y0, time, to, run.solver, budget);
    integrators.forEach((id, index) => x.set(id, advanced.y[index]!));
    recorded.append([
      {
        time: to,
        microstep: 0,
        phase: "solver",
        kind: "solver.step",
        entityId: run.solver.method,
        payload: { from: time, steps: advanced.steps, rejected: advanced.rejected },
      },
    ]);
  };

  /** The earliest pending activity: clock tick, chart timer, external input or stop. */
  const nextBoundary = (): RationalTime => {
    const candidates: Array<RationalTime> = [run.stop];
    for (const clock of resolved.clocks) candidates.push(tickTime(clock.id));
    const input = inputs[nextInput];
    if (input !== undefined) candidates.push(input.time);
    for (const state of charts.values()) {
      const timer = pendingTimers(state)[0];
      if (timer !== undefined) candidates.push(timer.due);
    }
    return candidates.reduce((earliest, candidate) =>
      compare(candidate, earliest) < 0 ? candidate : earliest,
    );
  };

  const boundary = (t: RationalTime) => {
    phase = "solver";
    advance(t);
    time = t;
    const pre = observe("pre");
    const due = resolved.clocks.filter((clock) => compare(tickTime(clock.id), t) === 0);
    const env = continuous();

    // Rate transitions read what their source committed before this instant.
    const previous = new Map<string, SignalValue | undefined>();
    for (const clock of due)
      for (const step of resolved.clockSchedules[clock.id] ?? [])
        if (node(step.node).type === "std.rate_transition@1")
          previous.set(step.node, inputOf(node(step.node), "value", env));

    // Phase B has nothing to apply: v0.1 runs carry events only, no value timelines.
    // Phase C: external events and due timers in `(priority, source, sequence)` order.
    phase = "event";
    const items: Array<BoundaryItem> = [];
    while (nextInput < inputs.length && compare(inputs[nextInput]!.time, t) === 0) {
      const input = inputs[nextInput++]!;
      for (const chartNode of chartNodes)
        if (resolved.charts[chartNode]!.chart.interface.events.some((e) => e.id === input.type))
          items.push({ kind: "event", node: chartNode, input });
    }
    for (const chartNode of chartNodes)
      for (const timer of pendingTimers(charts.get(chartNode)!))
        if (compare(timer.due, t) === 0) items.push({ kind: "timer", node: chartNode, timer });
    for (const item of items.toSorted((a, b) => byKey(boundaryKey(a), boundaryKey(b)))) {
      const state = charts.get(item.node)!;
      // An earlier item at this boundary may have exited the timer's owner.
      if (
        item.kind === "timer" &&
        !state.timers.some(
          (timer) =>
            timer.transitionId === item.timer.transitionId &&
            timer.generation === item.timer.generation,
        )
      )
        continue;
      const trigger: ChartTrigger =
        item.kind === "event"
          ? { kind: "event", id: item.input.type }
          : {
              kind: "timer",
              transitionId: item.timer.transitionId,
              generation: item.timer.generation,
            };
      applyChart(
        item.node,
        runToCompletion(
          resolved.charts[item.node]!.chart,
          state,
          trigger,
          chartCtx(t, "event", chartInputs(item.node, env)),
        ),
      );
    }

    // Phase D: each due clock runs its causal schedule, then commits its partition.
    phase = "clock";
    const published = new Map<string, SignalValue>();
    for (const clock of due) {
      const overlay = new Map<string, SignalValue>();
      const staged = new Map<string, SignalValue>();
      const tick: Env = { ...env, overlay };
      const steps = resolved.clockSchedules[clock.id] ?? [];
      for (const step of steps) {
        const target = node(step.node);
        switch (step.action) {
          case "sample": {
            const value =
              target.type === "std.rate_transition@1"
                ? previous.get(target.id)
                : inputOf(target, "value", tick);
            if (value !== undefined) overlay.set(target.id, value);
            signal("signal.sample", target.id, value, clock.id);
            break;
          }
          case "evaluate":
            overlay.set(target.id, pure(target, tick));
            break;
          case "chart":
            applyChart(
              target.id,
              runToCompletion(
                resolved.charts[target.id]!.chart,
                charts.get(target.id)!,
                { kind: "clock", id: clock.id },
                chartCtx(t, "clock", chartInputs(target.id, tick)),
              ),
            );
            break;
          case "stage":
            staged.set(
              target.id,
              target.type === "std.counter@1"
                ? (registers.get(target.id) as number) + (target.parameters.increment as number)
                : inputOf(target, "value", tick),
            );
            break;
        }
      }
      for (const [id, value] of overlay) registers.set(id, value);
      for (const [id, value] of staged)
        if (node(id).type === "std.hold@1") published.set(id, value);
        else registers.set(id, value);
      for (const step of steps) {
        if (step.action === "chart")
          for (const [port, value] of Object.entries(charts.get(step.node)!.outputs).toSorted(
            ([a], [b]) => (a < b ? -1 : 1),
          ))
            signal("signal.commit", `${step.node}.${port}`, value as SignalValue, clock.id);
        else
          signal(
            "signal.commit",
            step.node,
            published.get(step.node) ?? registers.get(step.node),
            clock.id,
          );
      }
      ticks.set(clock.id, ticks.get(clock.id)! + 1n);
    }

    // Phase E: publish held inputs; the plant sees them on (t, next].
    phase = "post";
    for (const [id, value] of published) holds.set(id, value);
    const post = observe("post");
    pre.forEach((sample, index) => {
      if (sample.value !== post[index]!.value) recorded.samples.push(sample);
    });
    recorded.samples.push(...post);
    committed = t;
  };

  const finish = (status: RunStatus, diagnostics: ReadonlyArray<ModelDiagnostic> = []) =>
    (result = outcome(recorded, status, time, committed, diagnostics, phase, resolved.systemId, {
      semanticDigest: resolved.semanticDigest,
      planDigest: resolved.planDigest,
      solver: run.solver.method,
      runtime: RUNTIME_VERSION,
    }));

  const step = (maxBoundaries: number): SimulationProgress => {
    if (result !== undefined) return { done: true, outcome: result };
    try {
      if (!started) {
        started = true;
        initializeModel();
      }
      for (let count = 0; count < maxBoundaries; count++) {
        const t = nextBoundary();
        boundary(t);
        boundaries++;
        if (compare(t, run.stop) === 0) {
          phase = "final";
          return { done: true, outcome: finish("completed") };
        }
      }
    } catch (cause) {
      if (!(cause instanceof RunFault)) throw cause;
      return { done: true, outcome: finish("failed", [cause.diagnostic]) };
    }
    return { done: false, time: committed, boundaries };
  };

  return {
    runId: options.runId,
    step,
    cancel: () => result ?? finish("cancelled"),
  };
};
