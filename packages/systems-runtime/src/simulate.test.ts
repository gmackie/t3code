import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { format } from "@t3tools/systems-model/rational";
import type { RunOutcome } from "@t3tools/systems-model/trace";

import { capabilities, checkRequirements, requirementsOf } from "./capabilities.ts";
import {
  clock,
  compiledRun,
  edge,
  loadFiles,
  readJson,
  runOf,
  system,
  withJson,
} from "./pack.testkit.ts";
import { createSimulation, simulate } from "./simulate.ts";

const CROSS_CLOCK = "experiments/cross-clock.run.json";

const registers = system("test.registers", {
  clocks: [clock("clock.fast", [1, 1], 10)],
  nodes: [
    {
      id: "counter",
      type: "std.counter@1",
      parameters: { clock: "clock.fast", initial: 0, increment: 1 },
    },
    {
      id: "delay",
      type: "std.delay@1",
      parameters: { clock: "clock.fast", initial: -1, unit: "1" },
    },
    { id: "hold", type: "std.hold@1", parameters: { clock: "clock.fast", initial: 0, unit: "1" } },
  ],
  edges: [edge("e.delay", "counter", "delay"), edge("e.hold", "counter", "hold")],
  outputs: { count: "counter", delayed: "delay", held: "hold" },
});

const samplesOf = (outcome: RunOutcome, signalId: string) =>
  outcome.samples
    .filter((sample) => sample.signalId === signalId)
    .map((sample) => `${format(sample.time)} ${sample.side} ${sample.value}`);

it.layer(NodeServices.layer)("discrete scheduler", (it) => {
  it.effect("registers read their committed value and publish the next one at t+", () =>
    Effect.gen(function* () {
      const files = withJson(
        withJson(yield* loadFiles, "models/registers.system.json", registers),
        "experiments/registers.run.json",
        runOf("models/registers.system.json", [2, 1], { method: "none" }),
      );
      const { run, resolved } = yield* compiledRun(files, "experiments/registers.run.json");
      const outcome = simulate(resolved, run, { runId: "registers" });
      assert.strictEqual(outcome.status, "completed");
      // `pre` is recorded only where it differs from `post`; `post` at every boundary.
      assert.deepStrictEqual(samplesOf(outcome, "count"), [
        "0 initial 0",
        "0 pre 0",
        "0 post 1",
        "1 pre 1",
        "1 post 2",
        "2 pre 2",
        "2 post 3",
      ]);
      assert.deepStrictEqual(samplesOf(outcome, "delayed"), [
        "0 initial -1",
        "0 pre -1",
        "0 post 0",
        "1 pre 0",
        "1 post 1",
        "2 pre 1",
        "2 post 2",
      ]);
      assert.deepStrictEqual(samplesOf(outcome, "held"), [
        "0 initial 0",
        "0 post 0",
        "1 pre 0",
        "1 post 1",
        "2 pre 1",
        "2 post 2",
      ]);
    }),
  );

  it.effect("events and chart timers inside a system are boundaries; timers precede ticks", () =>
    Effect.gen(function* () {
      const model = system("test.timed", {
        clocks: [clock("clock.fast", [1, 1], 10)],
        nodes: [
          {
            id: "ctl",
            type: "std.statechart@1",
            parameters: { chart: "statecharts/timer.chart.json", clock: "clock.fast" },
          },
          { id: "counter", type: "std.counter@1", parameters: { clock: "clock.fast" } },
        ],
        edges: [],
        outputs: { count: "counter" },
      });
      const start = {
        kind: "event",
        time: { num: "1", den: "2" },
        type: "start",
        priority: 100,
        sourceId: "test",
        ordinal: 0,
      };
      const files = withJson(
        withJson(yield* loadFiles, "models/timed.system.json", model),
        "experiments/timed.run.json",
        runOf("models/timed.system.json", [3, 1], { method: "none" }, [start]),
      );
      const { run, resolved } = yield* compiledRun(files, "experiments/timed.run.json");
      const outcome = simulate(resolved, run, { runId: "timed" });
      assert.strictEqual(outcome.status, "completed");
      const at = (time: string) =>
        outcome.trace
          .filter((event) => format(event.time) === time && event.kind !== "state.exit")
          .map((event) => `${event.phase}:${event.kind}:${event.entityId}`);
      assert.deepStrictEqual(at("1/2"), [
        "event:event.consume:start",
        "event:transition.fire:tr.start",
        "event:state.enter:state.armed",
      ]);
      // after(3/2) from t=1/2 is due with the t=2 tick: Phase C runs it before Phase D.
      assert.deepStrictEqual(at("2"), [
        "event:event.consume:tr.timeout",
        "event:transition.fire:tr.timeout",
        "event:state.enter:state.expired",
        "clock:event.ignored:clock.fast",
        "clock:signal.commit:counter",
      ]);
      assert.isTrue(outcome.trace.every((event, index) => event.sequence === String(index)));
      assert.isTrue(
        outcome.trace
          .filter((event) => event.kind.startsWith("state.") || event.kind.startsWith("event."))
          .every((event) => event.correlationId === "ctl"),
      );
    }),
  );

  it.effect("cancelling between chunks keeps a prefix of the full run's trace", () =>
    Effect.gen(function* () {
      const { run, resolved } = yield* compiledRun(yield* loadFiles, CROSS_CLOCK);
      const full = simulate(resolved, run, { runId: "r" });
      const simulation = createSimulation(resolved, run, { runId: "r" });
      const progress = simulation.step(2);
      assert.isFalse(progress.done);
      assert.strictEqual(progress.done ? "" : format(progress.time), "1");
      const cancelled = simulation.cancel();
      assert.strictEqual(cancelled.status, "cancelled");
      assert.strictEqual(format(cancelled.lastCommittedTime), "1");
      const finish = cancelled.trace.at(-1)!;
      assert.strictEqual(finish.kind, "run.finish");
      assert.deepStrictEqual(
        cancelled.trace.slice(0, -1),
        full.trace.slice(0, cancelled.trace.length - 1),
      );
      assert.deepStrictEqual(cancelled.samples, full.samples.slice(0, cancelled.samples.length));
      assert.strictEqual(simulation.step(10).done && simulation.cancel(), cancelled);
    }),
  );

  it.effect("repeated runs and reordered sources give identical traces", () =>
    Effect.gen(function* () {
      const files = yield* loadFiles;
      const { run, resolved } = yield* compiledRun(files, CROSS_CLOCK);
      const first = simulate(resolved, run, { runId: "r" });
      assert.deepStrictEqual(simulate(resolved, run, { runId: "r" }), first);
      const model = readJson(files, "models/cross-clock.system.json");
      const reordered = withJson(files, "models/cross-clock.system.json", {
        ...model,
        clocks: model.clocks.toReversed(),
        nodes: model.nodes.toReversed(),
        edges: model.edges.toReversed(),
        outputs: model.outputs.toReversed(),
      });
      const again = yield* compiledRun(reordered, CROSS_CLOCK);
      assert.deepStrictEqual(simulate(again.resolved, again.run, { runId: "r" }), first);
    }),
  );

  it.effect("a run the runner cannot execute is E-TARGET-001 before anything runs", () =>
    Effect.gen(function* () {
      const files = yield* loadFiles;
      const decay = readJson(files, "experiments/exponential-decay.run.json");
      const { run, resolved } = yield* compiledRun(
        withJson(files, "experiments/exponential-decay.run.json", {
          ...decay,
          solver: { method: "none" },
        }),
        "experiments/exponential-decay.run.json",
      );
      const outcome = simulate(resolved, run, { runId: "r" });
      assert.strictEqual(outcome.status, "failed");
      assert.deepStrictEqual(
        outcome.diagnostics.map((diagnostic) => diagnostic.code),
        outcome.diagnostics.map(() => "E-TARGET-001"),
      );
      assert.isTrue(outcome.diagnostics.length > 0);
      assert.deepStrictEqual(outcome.samples, []);
      assert.deepStrictEqual(
        outcome.trace.map((event) => event.kind),
        [...outcome.diagnostics.map(() => "diagnostic"), "run.finish"],
      );

      const chartRun = yield* compiledRun(files, "experiments/hierarchy.run.json");
      const runner = capabilities();
      const withoutCharts = {
        ...runner,
        capabilities: { ...runner.capabilities, statechartExclusive: false },
      };
      assert.deepStrictEqual(
        checkRequirements(requirementsOf(chartRun.resolved, chartRun.run), withoutCharts).map(
          (diagnostic) => diagnostic.code,
        ),
        ["E-TARGET-001"],
      );
    }),
  );
});
