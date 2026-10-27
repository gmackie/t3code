import { assert, describe, it } from "@effect/vitest";

import type { ChartDocument, Expr, RunDocument } from "@t3tools/systems-model/documents";
import { compare, make, type RationalTime } from "@t3tools/systems-model/rational";
import { validateChart } from "@t3tools/systems-model/validate";

import {
  activeLeaf,
  initialize,
  pendingTimers,
  runToCompletion,
  type ChartContext,
  type ChartState,
  type ChartStep,
  type ChartTrigger,
} from "./chart.ts";
import { runChartExperiment } from "./experiment.ts";

type Spec = Pick<ChartDocument, "states" | "transitions"> &
  Partial<Pick<ChartDocument["interface"], "inputs" | "outputs">> & {
    readonly events?: ReadonlyArray<string>;
  };

/** A statically valid chart rooted at `root`. */
const chart = (spec: Spec): ChartDocument => {
  const document: ChartDocument = {
    format: "sw.statechart",
    schemaVersion: "0.1.0",
    semanticsVersion: "0.1",
    id: "test.chart",
    interface: {
      inputs: spec.inputs ?? [],
      outputs: spec.outputs ?? [],
      events: (spec.events ?? []).map((id) => ({ id })),
    },
    root: "root",
    states: spec.states,
    transitions: spec.transitions,
  };
  assert.deepStrictEqual(validateChart(document), []);
  return document;
};

const at = (num: number, den = 1): RationalTime => make(BigInt(num), BigInt(den));
const ctx = (time: RationalTime, inputs: ChartContext["inputs"] = {}): ChartContext => ({
  time,
  inputs,
  phase: "event",
});
const literal = (value: number | boolean): Expr => ({ op: "literal", value });
const ref = (path: string): Expr => ({ op: "ref", path });
const event = (id: string): ChartTrigger => ({ kind: "event", id });
const after = (num: number, den = 1) => ({ kind: "after", duration: at(num, den) }) as const;
const on = (id: string) => ({ kind: "event", id }) as const;
const counter = { id: "count", type: "float64", initial: 0 } as const;
const increment = (target: string) =>
  ({
    op: "assign",
    target,
    value: { op: "add", left: ref(target), right: literal(1) },
  }) as const;

const ok = (step: ChartStep): ChartState => {
  assert.isUndefined(step.diagnostic, step.diagnostic?.message);
  return step.state;
};

const kinds = (step: ChartStep) => step.trace.map((entry) => [entry.kind, entry.entityId]);

describe("self-transitions", () => {
  const waiting = chart({
    events: ["poke", "kick"],
    outputs: [counter],
    states: [
      { id: "root", type: "compound", initial: "waiting" },
      { id: "waiting", type: "atomic", parent: "root", entry: [increment("output.count")] },
      { id: "done", type: "atomic", parent: "root" },
    ],
    transitions: [
      {
        id: "tr.timeout",
        source: "waiting",
        target: "done",
        kind: "external",
        trigger: after(2),
        priority: 1,
      },
      {
        id: "tr.poke",
        source: "waiting",
        target: "waiting",
        kind: "internal",
        trigger: on("poke"),
        priority: 1,
      },
      {
        id: "tr.kick",
        source: "waiting",
        target: "waiting",
        kind: "external",
        trigger: on("kick"),
        priority: 1,
      },
    ],
  });

  it("an internal self-transition keeps the running timer and skips entry", () => {
    const start = ok(initialize(waiting, { ...ctx(at(0)), phase: "initialize" }));
    const step = runToCompletion(waiting, start, event("poke"), ctx(at(1)));
    assert.deepStrictEqual(kinds(step), [
      ["event.consume", "poke"],
      ["transition.fire", "tr.poke"],
    ]);
    assert.deepStrictEqual(pendingTimers(ok(step)), pendingTimers(start));
    assert.strictEqual(ok(step).outputs.count, 1);
  });

  it("an external self-transition exits, re-enters and restarts the timer", () => {
    const start = ok(initialize(waiting, { ...ctx(at(0)), phase: "initialize" }));
    const step = runToCompletion(waiting, start, event("kick"), ctx(at(1)));
    assert.deepStrictEqual(kinds(step), [
      ["event.consume", "kick"],
      ["state.exit", "waiting"],
      ["transition.fire", "tr.kick"],
      ["state.enter", "waiting"],
    ]);
    const [before] = pendingTimers(start);
    const [restarted, ...rest] = pendingTimers(ok(step));
    assert.deepStrictEqual(rest, []);
    assert.deepStrictEqual(restarted?.due, at(3));
    assert.isAbove(restarted!.generation, before!.generation);
    assert.strictEqual(ok(step).outputs.count, 2);
  });
});

describe("timers", () => {
  const armed = chart({
    events: ["arm", "leave"],
    states: [
      { id: "root", type: "compound", initial: "idle" },
      { id: "idle", type: "atomic", parent: "root" },
      { id: "armed", type: "atomic", parent: "root" },
      { id: "fired", type: "atomic", parent: "root" },
    ],
    transitions: [
      {
        id: "tr.arm",
        source: "idle",
        target: "armed",
        kind: "external",
        trigger: on("arm"),
        priority: 1,
      },
      {
        id: "tr.leave",
        source: "armed",
        target: "idle",
        kind: "external",
        trigger: on("leave"),
        priority: 1,
      },
      {
        id: "tr.fire",
        source: "armed",
        target: "fired",
        kind: "external",
        trigger: after(1),
        priority: 1,
      },
    ],
  });

  it("a timer from an earlier entry never fires after exit and re-entry", () => {
    let state = ok(initialize(armed, { ...ctx(at(0)), phase: "initialize" }));
    state = ok(runToCompletion(armed, state, event("arm"), ctx(at(0))));
    const [stale] = pendingTimers(state);
    state = ok(runToCompletion(armed, state, event("leave"), ctx(at(1, 2))));
    assert.deepStrictEqual(pendingTimers(state), []);
    state = ok(runToCompletion(armed, state, event("arm"), ctx(at(1, 2))));
    const [fresh] = pendingTimers(state);
    assert.deepStrictEqual(fresh?.due, at(3, 2));

    const late = runToCompletion(
      armed,
      state,
      { kind: "timer", transitionId: stale!.transitionId, generation: stale!.generation },
      ctx(at(1)),
    );
    assert.deepStrictEqual(kinds(late), [["event.ignored", "tr.fire"]]);
    assert.strictEqual(activeLeaf(ok(late)), "armed");

    const due = runToCompletion(
      armed,
      ok(late),
      { kind: "timer", transitionId: fresh!.transitionId, generation: fresh!.generation },
      ctx(at(3, 2)),
    );
    assert.strictEqual(activeLeaf(ok(due)), "fired");
  });

  it("the experiment driver fires only the re-armed timer, at re-entry time plus the delay", () => {
    const run: RunDocument = {
      format: "sw.run",
      schemaVersion: "0.1.0",
      id: "run.rearm",
      chartRef: "test.chart.json",
      start: at(0),
      stop: at(3),
      solver: { method: "none" },
      inputs: [
        { kind: "event", time: at(0), type: "arm", priority: 1, sourceId: "test", ordinal: 0 },
        { kind: "event", time: at(1, 2), type: "leave", priority: 1, sourceId: "test", ordinal: 0 },
        { kind: "event", time: at(1, 2), type: "arm", priority: 1, sourceId: "test", ordinal: 1 },
      ],
      seed: "0",
      probes: [],
    };
    const outcome = runChartExperiment(armed, run, { runId: "rearm" });
    const fires = outcome.trace.filter((entry) => entry.kind === "transition.fire");
    assert.deepStrictEqual(
      fires.map((entry) => [entry.entityId, entry.time]),
      [
        ["tr.arm", at(0)],
        ["tr.leave", at(1, 2)],
        ["tr.arm", at(1, 2)],
        ["tr.fire", at(3, 2)],
      ],
    );
  });
});

describe("actions", () => {
  it("emitted events queue FIFO and are consumed after the whole action list commits", () => {
    const emitter = chart({
      events: ["go", "a", "b"],
      outputs: [{ id: "x", type: "float64", initial: 0 }],
      states: [
        { id: "root", type: "compound", initial: "idle" },
        { id: "idle", type: "atomic", parent: "root" },
        { id: "s1", type: "atomic", parent: "root" },
        { id: "s2", type: "atomic", parent: "root" },
        { id: "s3", type: "atomic", parent: "root" },
      ],
      transitions: [
        {
          id: "tr.go",
          source: "idle",
          target: "s1",
          kind: "external",
          trigger: on("go"),
          priority: 1,
          actions: [
            { op: "emit", eventId: "a" },
            { op: "assign", target: "output.x", value: literal(1) },
            { op: "emit", eventId: "b" },
          ],
        },
        {
          id: "tr.a",
          source: "s1",
          target: "s2",
          kind: "external",
          trigger: on("a"),
          priority: 1,
          // Only true if `a` is handled after `x = 1` committed.
          guard: { op: "eq", left: ref("output.x"), right: literal(1) },
        },
        { id: "tr.b", source: "s2", target: "s3", kind: "external", trigger: on("b"), priority: 1 },
      ],
    });
    const start = ok(initialize(emitter, { ...ctx(at(0)), phase: "initialize" }));
    const step = runToCompletion(emitter, start, event("go"), ctx(at(1)));
    assert.deepStrictEqual(kinds(step), [
      ["event.consume", "go"],
      ["state.exit", "idle"],
      ["transition.fire", "tr.go"],
      ["state.enter", "s1"],
      ["event.emit", "a"],
      ["event.emit", "b"],
      ["event.consume", "a"],
      ["state.exit", "s1"],
      ["transition.fire", "tr.a"],
      ["state.enter", "s2"],
      ["event.consume", "b"],
      ["state.exit", "s2"],
      ["transition.fire", "tr.b"],
      ["state.enter", "s3"],
    ]);
    assert.deepStrictEqual(
      step.trace.map((entry) => entry.microstep),
      [0, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3],
    );
    assert.deepStrictEqual(ok(step).queue, []);
  });

  it("assignments are staged: exit, transition and entry actions read earlier writes", () => {
    const staged = chart({
      events: ["go"],
      outputs: [
        { id: "x", type: "float64", initial: 0 },
        { id: "y", type: "float64", initial: 0 },
      ],
      states: [
        { id: "root", type: "compound", initial: "a" },
        {
          id: "a",
          type: "atomic",
          parent: "root",
          exit: [{ op: "assign", target: "output.x", value: literal(5) }],
        },
        {
          id: "b",
          type: "atomic",
          parent: "root",
          entry: [
            {
              op: "assign",
              target: "output.y",
              value: { op: "mul", left: ref("output.y"), right: literal(10) },
            },
          ],
        },
      ],
      transitions: [
        {
          id: "tr.go",
          source: "a",
          target: "b",
          kind: "external",
          trigger: on("go"),
          priority: 1,
          // The guard reads the committed snapshot, before the exit action's write.
          guard: { op: "eq", left: ref("output.x"), right: literal(0) },
          actions: [
            {
              op: "assign",
              target: "output.y",
              value: { op: "add", left: ref("output.x"), right: literal(1) },
            },
            {
              op: "assign",
              target: "output.x",
              value: { op: "mul", left: ref("output.x"), right: literal(2) },
            },
          ],
        },
      ],
    });
    const start = ok(initialize(staged, { ...ctx(at(0)), phase: "initialize" }));
    const state = ok(runToCompletion(staged, start, event("go"), ctx(at(1))));
    assert.deepStrictEqual(state.outputs, { x: 10, y: 60 });
  });
});

describe("selection", () => {
  const guarded = chart({
    events: ["tick"],
    inputs: [{ id: "d", type: "float64" }],
    states: [
      { id: "root", type: "compound", initial: "a" },
      { id: "a", type: "atomic", parent: "root" },
      { id: "b", type: "atomic", parent: "root" },
    ],
    transitions: [
      {
        id: "tr.ratio",
        source: "a",
        target: "b",
        kind: "external",
        trigger: on("tick"),
        priority: 1,
        guard: {
          op: "gt",
          left: { op: "div", left: literal(1), right: ref("input.d") },
          right: literal(2),
        },
      },
    ],
  });

  it("an event with no enabled transition is traced as ignored and changes nothing", () => {
    const start = ok(initialize(guarded, { ...ctx(at(0), { d: 1 }), phase: "initialize" }));
    const step = runToCompletion(guarded, start, event("tick"), ctx(at(1), { d: 1 }));
    assert.deepStrictEqual(kinds(step), [["event.ignored", "tick"]]);
    assert.deepStrictEqual(step.state.activePath, start.activePath);
  });

  it("a guard dividing by zero fails the step with E-NUM-001 instead of being false", () => {
    const start = ok(initialize(guarded, { ...ctx(at(0), { d: 1 }), phase: "initialize" }));
    const step = runToCompletion(guarded, start, event("tick"), ctx(at(1), { d: 0 }));
    assert.strictEqual(step.diagnostic?.code, "E-NUM-001");
    assert.strictEqual(step.diagnostic?.elementId, "tr.ratio");
    assert.strictEqual(step.diagnostic?.pointer, "/transitions/0/guard");
    assert.deepStrictEqual(step.state.activePath, start.activePath);
  });

  it("a microstep limit outside the allowed range is E-TIME-001", () => {
    const step = initialize(guarded, {
      ...ctx(at(0), { d: 1 }),
      phase: "initialize",
      microstepLimit: 0,
    });
    assert.strictEqual(step.diagnostic?.code, "E-TIME-001");
  });
});

describe("random event sequences on a hierarchy", () => {
  // The CHART-001 hierarchy, made live: recovery, restart, an internal pause and a timer.
  const hierarchy = chart({
    events: ["overload", "recover", "start", "pause"],
    outputs: [counter],
    states: [
      { id: "root", type: "compound", initial: "normal" },
      { id: "normal", type: "compound", parent: "root", initial: "running" },
      { id: "running", type: "atomic", parent: "normal" },
      { id: "cooling", type: "atomic", parent: "normal" },
      { id: "fault", type: "atomic", parent: "root", entry: [increment("output.count")] },
      { id: "off", type: "atomic", parent: "root" },
    ],
    transitions: [
      {
        id: "tr.child",
        source: "running",
        target: "fault",
        kind: "external",
        trigger: on("overload"),
        priority: 50,
      },
      {
        id: "tr.parent",
        source: "normal",
        target: "off",
        kind: "external",
        trigger: on("overload"),
        priority: 1,
      },
      {
        id: "tr.recover",
        source: "fault",
        target: "cooling",
        kind: "external",
        trigger: on("recover"),
        priority: 1,
      },
      {
        id: "tr.cooled",
        source: "cooling",
        target: "running",
        kind: "external",
        trigger: after(1, 3),
        priority: 1,
      },
      {
        id: "tr.start",
        source: "off",
        target: "normal",
        kind: "external",
        trigger: on("start"),
        priority: 1,
      },
      {
        id: "tr.pause",
        source: "normal",
        target: "normal",
        kind: "internal",
        trigger: on("pause"),
        priority: 1,
      },
      {
        id: "tr.reset",
        source: "normal",
        target: "normal",
        kind: "external",
        trigger: on("start"),
        priority: 2,
      },
    ],
  });
  const states = new Map(hierarchy.states.map((state) => [state.id, state]));
  const names = ["overload", "recover", "start", "pause"] as const;

  /** Deterministic LCG, so a failure reproduces from its seed. */
  const random = (seed: number) => () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };

  const assertWellFormed = (state: ChartState) => {
    const path = state.activePath;
    assert.strictEqual(path[0], hierarchy.root);
    path.slice(1).forEach((id, index) => assert.strictEqual(states.get(id)?.parent, path[index]));
    assert.strictEqual(states.get(activeLeaf(state)!)?.type, "atomic");
    assert.deepStrictEqual(Object.keys(state.entries).toSorted(), path.toSorted());
    for (const timer of state.timers)
      assert.strictEqual(state.entries[timer.owner]?.generation, timer.generation);
  };

  const scenario = (seed: number): RunDocument => {
    const next = random(seed);
    return {
      format: "sw.run",
      schemaVersion: "0.1.0",
      id: "run.random",
      chartRef: "hierarchy.chart.json",
      start: at(0),
      stop: at(10),
      solver: { method: "none" },
      inputs: Array.from({ length: 30 }, (_, ordinal) => ({
        kind: "event" as const,
        time: at(Math.floor(next() * 60), 6),
        type: names[Math.floor(next() * names.length)]!,
        priority: Math.floor(next() * 3),
        sourceId: "random",
        ordinal,
      })),
      seed: String(seed),
      probes: [],
    };
  };

  it("keeps one root-to-leaf active chain after every step", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const run = scenario(seed);
      let state = ok(initialize(hierarchy, { ...ctx(at(0)), phase: "initialize" }));
      assertWellFormed(state);
      const inputs = run.inputs.toSorted((a, b) => compare(a.time, b.time));
      for (const input of inputs) {
        for (const timer of pendingTimers(state)) {
          if (compare(timer.due, input.time) > 0) break;
          const trigger = {
            kind: "timer",
            transitionId: timer.transitionId,
            generation: timer.generation,
          } as const;
          state = ok(runToCompletion(hierarchy, state, trigger, ctx(timer.due)));
          assertWellFormed(state);
        }
        state = ok(runToCompletion(hierarchy, state, event(input.type), ctx(input.time)));
        assertWellFormed(state);
      }
    }
  });

  it("produces identical outcomes when a run is repeated", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const run = scenario(seed);
      const first = runChartExperiment(hierarchy, run, { runId: "a" });
      assert.strictEqual(first.status, "completed");
      assert.deepStrictEqual(
        runChartExperiment(hierarchy, structuredClone(run), { runId: "a" }),
        first,
      );
    }
  });
});
