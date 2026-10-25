import { error, type ModelDiagnostic } from "@t3tools/systems-model/diagnostics";
import type {
  Action,
  ChartDocument,
  ChartState as ChartStateDocument,
  ChartTransition,
  Expr,
} from "@t3tools/systems-model/documents";
import { add, compare, format, type RationalTime } from "@t3tools/systems-model/rational";
import type { SignalValue, TraceEvent, TracePhase } from "@t3tools/systems-model/trace";

/**
 * Reference interpreter for RFC-001 §7 statecharts. Every function is pure over plain
 * JSON data, so a scheduler can persist, replay or ship a `ChartState` across threads.
 */

export type ChartValue = number | boolean | string;

export type ChartTrigger =
  | { readonly kind: "event"; readonly id: string }
  | { readonly kind: "clock"; readonly id: string }
  | { readonly kind: "timer"; readonly transitionId: string; readonly generation: number };

/** A trace event before the caller assigns `runId` and `sequence`. */
export type TraceDraft = Omit<TraceEvent, "runId" | "sequence">;

export interface ChartContext {
  readonly time: RationalTime;
  readonly inputs: Readonly<Record<string, SignalValue>>;
  readonly phase: TracePhase;
  /** Transitions allowed per physical time; defaults to `DEFAULT_MICROSTEP_LIMIT`. */
  readonly microstepLimit?: number;
}

export interface PendingTimer {
  readonly chartId: string;
  readonly transitionId: string;
  /** The state whose entry started the timer; exiting it cancels the timer. */
  readonly owner: string;
  readonly due: RationalTime;
  readonly generation: number;
  readonly priority: number;
}

export interface ChartState {
  readonly chartId: string;
  /** Active states from the root down to the active leaf. */
  readonly activePath: ReadonlyArray<string>;
  /** Entry generation and time of each active state. */
  readonly entries: Readonly<
    Record<string, { readonly generation: number; readonly time: RationalTime }>
  >;
  /** Next entry generation; never reused, so stale timers stay detectable. */
  readonly nextGeneration: number;
  readonly timers: ReadonlyArray<PendingTimer>;
  readonly outputs: Readonly<Record<string, ChartValue>>;
  /** Internal events emitted but not yet consumed. Empty after a successful step. */
  readonly queue: ReadonlyArray<string>;
  /** Transitions already fired at `time`; the superdense index of the current state. */
  readonly microstep: { readonly time: RationalTime; readonly index: number };
}

export interface ChartStep {
  /** On a diagnostic, the last state committed at a microstep boundary. */
  readonly state: ChartState;
  readonly trace: ReadonlyArray<TraceDraft>;
  readonly diagnostic?: ModelDiagnostic;
}

export const DEFAULT_MICROSTEP_LIMIT = 1024;
export const MAX_MICROSTEP_LIMIT = 65_536;

export const activeLeaf = (state: ChartState): string | undefined => state.activePath.at(-1);

const timerKey = (timer: PendingTimer) => [timer.chartId, timer.transitionId] as const;

/** Pending timers in RFC-001 §7.5 order: `(due, priority, chartId, transitionId, generation)`. */
export const pendingTimers = (state: ChartState): ReadonlyArray<PendingTimer> =>
  state.timers.toSorted((a, b) => {
    const byDue = compare(a.due, b.due);
    if (byDue !== 0) return byDue;
    if (a.priority !== b.priority) return a.priority - b.priority;
    const [left, right] = [timerKey(a), timerKey(b)];
    for (let index = 0; index < left.length; index++)
      if (left[index] !== right[index]) return left[index]! < right[index]! ? -1 : 1;
    return a.generation - b.generation;
  });

// Chart index

interface ChartIndex {
  readonly states: ReadonlyMap<string, ChartStateDocument>;
  readonly stateIndex: ReadonlyMap<string, number>;
  readonly transitions: ReadonlyMap<string, ChartTransition>;
  readonly transitionIndex: ReadonlyMap<string, number>;
  /** Outgoing transitions of each state, smallest priority first. */
  readonly bySource: ReadonlyMap<string, ReadonlyArray<ChartTransition>>;
  readonly inputs: ReadonlyMap<string, ChartDocument["interface"]["inputs"][number]>;
  readonly outputs: ReadonlyMap<string, ChartDocument["interface"]["outputs"][number]>;
}

const indexes = new WeakMap<ChartDocument, ChartIndex>();

const indexOf = (chart: ChartDocument): ChartIndex => {
  const cached = indexes.get(chart);
  if (cached !== undefined) return cached;
  const bySource = new Map<string, Array<ChartTransition>>();
  for (const transition of chart.transitions) {
    const list = bySource.get(transition.source) ?? [];
    list.push(transition);
    bySource.set(transition.source, list);
  }
  for (const list of bySource.values()) list.sort((a, b) => a.priority - b.priority);
  const index: ChartIndex = {
    states: new Map(chart.states.map((state) => [state.id, state])),
    stateIndex: new Map(chart.states.map((state, position) => [state.id, position])),
    transitions: new Map(chart.transitions.map((transition) => [transition.id, transition])),
    transitionIndex: new Map(
      chart.transitions.map((transition, position) => [transition.id, position]),
    ),
    bySource,
    inputs: new Map(chart.interface.inputs.map((input) => [input.id, input])),
    outputs: new Map(chart.interface.outputs.map((output) => [output.id, output])),
  };
  indexes.set(chart, index);
  return index;
};

/** Root-first ancestry of `id`, including `id`. */
const pathTo = (index: ChartIndex, id: string): ReadonlyArray<string> => {
  const path: Array<string> = [];
  for (let current: string | undefined = id; current !== undefined;) {
    path.unshift(current);
    current = index.states.get(current)?.parent;
  }
  return path;
};

/** `pathTo(target)` from `depth` down, then through `initial` children to a leaf. */
const entryPath = (index: ChartIndex, target: string, depth: number): ReadonlyArray<string> => {
  const path = pathTo(index, target).slice(depth);
  for (let state = index.states.get(target); state?.initial !== undefined;) {
    path.push(state.initial);
    state = index.states.get(state.initial);
  }
  return path;
};

// Expressions

/** A run error raised while evaluating a guard or action; becomes the step's diagnostic. */
class Fault extends Error {
  readonly diagnostic: ModelDiagnostic;
  constructor(diagnostic: ModelDiagnostic) {
    super(diagnostic.message);
    this.diagnostic = diagnostic;
  }
}

interface Site {
  readonly elementId: string;
  readonly pointer: string;
}

const fault = (code: ModelDiagnostic["code"], message: string, site: Site) =>
  new Fault(error(code, message, site));

const numeric = (value: ChartValue, site: Site): number => {
  if (typeof value !== "number")
    throw fault("E-TYPE-001", `Expected a number, got ${typeof value}`, site);
  if (!Number.isFinite(value)) throw fault("E-NUM-001", `Non-finite value ${value}`, site);
  return value;
};

const boolean = (value: ChartValue, site: Site): boolean => {
  if (typeof value !== "boolean")
    throw fault("E-TYPE-001", `Expected a boolean, got ${typeof value}`, site);
  return value;
};

const finite = (value: number, site: Site): number => {
  if (!Number.isFinite(value)) throw fault("E-NUM-001", `Arithmetic produced ${value}`, site);
  return value;
};

/** float64 evaluation; `and`/`or` short-circuit, so a skipped operand cannot fault. */
const evaluate = (expr: Expr, read: (path: string) => ChartValue, site: Site): ChartValue => {
  const value = (operand: Expr) => evaluate(operand, read, site);
  switch (expr.op) {
    case "literal":
      return expr.value;
    case "ref":
      return read(expr.path);
    case "not":
      return !boolean(value(expr.arg), site);
    case "and":
      return boolean(value(expr.left), site) && boolean(value(expr.right), site);
    case "or":
      return boolean(value(expr.left), site) || boolean(value(expr.right), site);
    case "eq":
    case "ne": {
      const left = value(expr.left);
      const right = value(expr.right);
      if (typeof left !== typeof right)
        throw fault("E-TYPE-001", `Cannot compare ${typeof left} with ${typeof right}`, site);
      if (typeof left === "number" && typeof right === "number") {
        numeric(left, site);
        numeric(right, site);
      }
      return expr.op === "eq" ? left === right : left !== right;
    }
  }
  const left = numeric(value(expr.left), site);
  const right = numeric(value(expr.right), site);
  switch (expr.op) {
    case "lt":
      return left < right;
    case "le":
      return left <= right;
    case "gt":
      return left > right;
    case "ge":
      return left >= right;
    case "add":
      return finite(left + right, site);
    case "sub":
      return finite(left - right, site);
    case "mul":
      return finite(left * right, site);
    case "div":
      if (right === 0) throw fault("E-NUM-001", "Division by zero", site);
      return finite(left / right, site);
  }
};

const VALUE_KIND = {
  bool: "boolean",
  int32: "number",
  uint32: "number",
  float32: "number",
  float64: "number",
  string: "string",
} as const;

const DEFAULT_VALUE = { boolean: false, number: 0, string: "" } as const;

/** Reads `input.<id>` from the context and `output.<id>` from `outputs`. */
const reader =
  (
    index: ChartIndex,
    ctx: ChartContext,
    outputs: Readonly<Record<string, ChartValue>>,
    site: Site,
  ) =>
  (path: string): ChartValue => {
    const [namespace, name = ""] = path.split(".");
    if (namespace === "output" && Object.hasOwn(outputs, name)) return outputs[name]!;
    if (namespace === "input") {
      const value =
        (Object.hasOwn(ctx.inputs, name) ? ctx.inputs[name] : undefined) ??
        index.inputs.get(name)?.initial;
      if (value !== undefined) return value;
      throw fault("E-REPLAY-001", `Input "${name}" has no value at ${format(ctx.time)}`, site);
    }
    throw fault("E-REF-001", `Reference "${path}" is not a declared input or output`, site);
  };

// Microsteps

type Selection =
  | { readonly kind: "event"; readonly id: string }
  | { readonly kind: "clock"; readonly id: string }
  | { readonly kind: "always" };

const matches = (transition: ChartTransition, selection: Selection) =>
  transition.trigger.kind === selection.kind &&
  (selection.kind === "always" ||
    ("id" in transition.trigger && transition.trigger.id === selection.id));

const guardSite = (index: ChartIndex, transition: ChartTransition): Site => ({
  elementId: transition.id,
  pointer: `/transitions/${index.transitionIndex.get(transition.id)}/guard`,
});

const enabled = (
  index: ChartIndex,
  state: ChartState,
  ctx: ChartContext,
  transition: ChartTransition,
) => {
  if (transition.guard === undefined) return true;
  const site = guardSite(index, transition);
  return boolean(evaluate(transition.guard, reader(index, ctx, state.outputs, site), site), site);
};

/** RFC-001 §7.2: the deepest source with an enabled transition wins, then the smallest priority. */
const select = (
  index: ChartIndex,
  state: ChartState,
  ctx: ChartContext,
  selection: Selection,
): ChartTransition | undefined => {
  for (let depth = state.activePath.length - 1; depth >= 0; depth--)
    for (const transition of index.bySource.get(state.activePath[depth]!) ?? [])
      if (matches(transition, selection) && enabled(index, state, ctx, transition))
        return transition;
  return undefined;
};

/**
 * One microstep (RFC-001 §7.3): exit deepest-first, transition actions, enter
 * outermost-first. `transition` is absent for root entry at initialization.
 * Writes are staged in order; the result is committed only if nothing faults.
 */
const microstep = (
  index: ChartIndex,
  chart: ChartDocument,
  state: ChartState,
  ctx: ChartContext,
  transition: ChartTransition | undefined,
  step: number,
): { readonly state: ChartState; readonly trace: ReadonlyArray<TraceDraft> } => {
  const trace: Array<TraceDraft> = [];
  const record = (kind: TraceDraft["kind"], entityId: string, payload?: unknown) =>
    trace.push({
      time: ctx.time,
      microstep: step,
      phase: ctx.phase,
      kind,
      entityId,
      ...(payload === undefined ? {} : { payload }),
    });
  const outputs = { ...state.outputs };
  const emitted: Array<string> = [];
  const run = (actions: ReadonlyArray<Action> | undefined, elementId: string, pointer: string) =>
    actions?.forEach((action, position) => {
      const site = { elementId, pointer: `${pointer}/${position}` };
      if (action.op === "emit") return void emitted.push(action.eventId);
      const name = action.target.slice("output.".length);
      const declared = index.outputs.get(name);
      if (!action.target.startsWith("output.") || declared === undefined)
        throw fault("E-REF-001", `Cannot assign "${action.target}"`, site);
      const value = evaluate(action.value, reader(index, ctx, outputs, site), site);
      if (typeof value !== VALUE_KIND[declared.type])
        throw fault(
          "E-TYPE-001",
          `Cannot assign a ${typeof value} to ${declared.type} "${name}"`,
          site,
        );
      outputs[name] = value;
    });
  const transitionPointer = (id: string) => `/transitions/${index.transitionIndex.get(id)}/actions`;
  const statePointer = (id: string, list: string) => `/states/${index.stateIndex.get(id)}/${list}`;

  if (transition?.kind === "internal") {
    run(transition.actions, transition.id, transitionPointer(transition.id));
    record("transition.fire", transition.id, {
      source: transition.source,
      target: transition.target,
    });
    return commit();
  }

  // The domain is the deepest proper ancestor of both ends, so an external
  // self-transition exits and re-enters its source.
  const target = transition?.target ?? chart.root;
  const sourceAncestors =
    transition === undefined ? [] : pathTo(index, transition.source).slice(0, -1);
  const targetAncestors = pathTo(index, target).slice(0, -1);
  let depth = 0;
  while (depth < sourceAncestors.length && sourceAncestors[depth] === targetAncestors[depth])
    depth++;

  const entries = { ...state.entries };
  let timers = state.timers;
  for (const id of state.activePath.slice(depth).toReversed()) {
    record("state.exit", id);
    run(index.states.get(id)?.exit, id, statePointer(id, "exit"));
    delete entries[id];
    timers = timers.filter((timer) => timer.owner !== id);
  }
  if (transition !== undefined) {
    run(transition.actions, transition.id, transitionPointer(transition.id));
    record("transition.fire", transition.id, {
      source: transition.source,
      target: transition.target,
    });
  }
  const entered = entryPath(index, target, depth);
  let generation = state.nextGeneration;
  const started: Array<PendingTimer> = [];
  for (const id of entered) {
    entries[id] = { generation, time: ctx.time };
    for (const candidate of index.bySource.get(id) ?? [])
      if (candidate.trigger.kind === "after")
        started.push({
          chartId: chart.id,
          transitionId: candidate.id,
          owner: id,
          due: add(ctx.time, candidate.trigger.duration),
          generation,
          priority: candidate.priority,
        });
    generation++;
    record("state.enter", id);
    run(index.states.get(id)?.entry, id, statePointer(id, "entry"));
  }
  return commit({
    activePath: [...state.activePath.slice(0, depth), ...entered],
    entries,
    nextGeneration: generation,
    timers: [...timers, ...started],
  });

  function commit(changes: Partial<ChartState> = {}) {
    for (const eventId of emitted) record("event.emit", eventId);
    return {
      state: {
        ...state,
        ...changes,
        outputs,
        queue: [...state.queue, ...emitted],
        microstep: { time: ctx.time, index: step },
      },
      trace,
    };
  }
};

/** The repeating tail of the leaves visited at one time, for an `E-TIME-002` report. */
const cycleOf = (
  history: ReadonlyArray<{ readonly transition: string; readonly leaf: string }>,
) => {
  for (let period = 1; period * 2 <= history.length; period++) {
    const tail = history.slice(-period);
    if (tail.every((entry, offset) => history.at(-period * 2 + offset)?.leaf === entry.leaf))
      return tail;
  }
  return history.slice(-1);
};

const unique = (values: ReadonlyArray<string>) => [...new Set(values)];

const limitOf = (chart: ChartDocument, ctx: ChartContext) => {
  const limit = ctx.microstepLimit ?? DEFAULT_MICROSTEP_LIMIT;
  if (Number.isInteger(limit) && limit >= 1 && limit <= MAX_MICROSTEP_LIMIT) return limit;
  throw new Fault(
    error("E-TIME-001", `Microstep limit must be an integer in 1..${MAX_MICROSTEP_LIMIT}`, {
      elementId: chart.id,
    }),
  );
};

/**
 * Run to completion (RFC-001 §6.3, §7.2): stabilize `always` transitions, dispatch
 * `trigger`, stabilize, then consume emitted events FIFO, stabilizing after each.
 */
const settle = (
  chart: ChartDocument,
  initial: ChartState,
  ctx: ChartContext,
  trigger: ChartTrigger | undefined,
): ChartStep => {
  const index = indexOf(chart);
  const trace: Array<TraceDraft> = [];
  let state =
    compare(initial.microstep.time, ctx.time) === 0
      ? initial
      : { ...initial, microstep: { time: ctx.time, index: 0 } };
  const history: Array<{ readonly transition: string; readonly leaf: string }> = [];

  const note = (kind: TraceDraft["kind"], entityId: string, payload: unknown) =>
    trace.push({
      time: ctx.time,
      microstep: state.microstep.index,
      phase: ctx.phase,
      kind,
      entityId,
      payload,
    });

  const fire = (transition: ChartTransition, limit: number) => {
    if (state.microstep.index >= limit) {
      const cycle = cycleOf(history);
      const states = unique(cycle.map((entry) => entry.leaf));
      const transitions = unique(cycle.map((entry) => entry.transition));
      throw new Fault(
        error(
          "E-TIME-002",
          `Zero-time cycle at t=${format(ctx.time)}: more than ${limit} microsteps while repeating ${states.join(" -> ")} via ${transitions.join(", ")}`,
          {
            elementId: chart.id,
            related: [...states, ...transitions].map((elementId) => ({ elementId })),
          },
        ),
      );
    }
    const next = microstep(index, chart, state, ctx, transition, state.microstep.index + 1);
    state = next.state;
    trace.push(...next.trace);
    history.push({ transition: transition.id, leaf: activeLeaf(state) ?? "" });
  };

  try {
    const limit = limitOf(chart, ctx);
    const dispatch = (selection: Selection, entityId: string, payload: unknown) => {
      const transition = select(index, state, ctx, selection);
      note(transition === undefined ? "event.ignored" : "event.consume", entityId, payload);
      if (transition !== undefined) fire(transition, limit);
    };
    const stabilize = () => {
      for (
        let transition = select(index, state, ctx, { kind: "always" });
        transition !== undefined;
        transition = select(index, state, ctx, { kind: "always" })
      )
        fire(transition, limit);
    };

    stabilize();
    if (trigger?.kind === "timer") {
      // Only a pending timer whose owner was not exited since it started may fire.
      const timer = state.timers.find(
        (candidate) =>
          candidate.transitionId === trigger.transitionId &&
          candidate.generation === trigger.generation &&
          compare(candidate.due, ctx.time) <= 0,
      );
      const transition = index.transitions.get(trigger.transitionId);
      if (timer === undefined || transition === undefined)
        note("event.ignored", trigger.transitionId, {
          trigger: "timer",
          generation: trigger.generation,
          reason: "stale",
        });
      else {
        state = { ...state, timers: state.timers.filter((candidate) => candidate !== timer) };
        const fires = enabled(index, state, ctx, transition);
        note(fires ? "event.consume" : "event.ignored", transition.id, {
          trigger: "timer",
          generation: timer.generation,
        });
        if (fires) fire(transition, limit);
      }
    } else if (trigger !== undefined) dispatch(trigger, trigger.id, { trigger: trigger.kind });
    stabilize();
    while (state.queue.length > 0) {
      const [eventId = "", ...rest] = state.queue;
      state = { ...state, queue: rest };
      dispatch({ kind: "event", id: eventId }, eventId, { trigger: "internal" });
      stabilize();
    }
    return { state, trace };
  } catch (cause) {
    if (!(cause instanceof Fault)) throw cause;
    return { state, trace, diagnostic: cause.diagnostic };
  }
};

/**
 * Enter the root and descend through `initial` children (microstep 0), then settle.
 * Outputs start from their declared `initial`, or the zero value of their type.
 */
export const initialize = (chart: ChartDocument, ctx: ChartContext): ChartStep => {
  const blank: ChartState = {
    chartId: chart.id,
    activePath: [],
    entries: {},
    nextGeneration: 0,
    timers: [],
    outputs: Object.fromEntries(
      chart.interface.outputs.map((output) => [
        output.id,
        output.initial ?? DEFAULT_VALUE[VALUE_KIND[output.type]],
      ]),
    ),
    queue: [],
    microstep: { time: ctx.time, index: 0 },
  };
  let entered: ReturnType<typeof microstep>;
  try {
    entered = microstep(indexOf(chart), chart, blank, ctx, undefined, 0);
  } catch (cause) {
    if (!(cause instanceof Fault)) throw cause;
    return { state: blank, trace: [], diagnostic: cause.diagnostic };
  }
  const settled = settle(chart, entered.state, ctx, undefined);
  return { ...settled, trace: [...entered.trace, ...settled.trace] };
};

/** Deliver one external event, clock tick or timer and settle every consequence. */
export const runToCompletion = (
  chart: ChartDocument,
  state: ChartState,
  trigger: ChartTrigger,
  ctx: ChartContext,
): ChartStep => settle(chart, state, ctx, trigger);
