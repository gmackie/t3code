import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import type { PackFiles } from "@t3tools/systems-model/pack";
import { format } from "@t3tools/systems-model/rational";
import type { RunOutcome } from "@t3tools/systems-model/trace";

import { compareToExpected } from "./compare.ts";
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

const PUMP_RUN = "experiments/pump-nominal.run.json";

/** `dx/dt = gain·x`, x(0)=1, sampled on a clock so its ticks are barriers. */
const exponential = (gain: number, period: [number, number]) =>
  system("test.exponential", {
    clocks: [clock("clock.sample", period, 1)],
    nodes: [
      {
        id: "state",
        type: "std.integrator@1",
        parameters: { initial: 1, unit: "1", derivativeUnit: "1/s" },
      },
      { id: "rate", type: "std.gain@1", parameters: { gain, gainUnit: "1/s" } },
      {
        id: "sampler",
        type: "std.sample@1",
        parameters: { clock: "clock.sample", unit: "1" },
      },
    ],
    edges: [
      edge("e.state", "state", "rate"),
      edge("e.derivative", "rate", "state:derivative"),
      edge("e.sample", "state", "sampler"),
    ],
    outputs: { x: "state", sampled: "sampler" },
  });

const exponentialRun = (
  files: PackFiles,
  gain: number,
  period: [number, number],
  stop: [number, number],
  solver: unknown,
) =>
  compiledRun(
    withJson(
      withJson(files, "models/exponential.system.json", exponential(gain, period)),
      "experiments/exponential.run.json",
      runOf("models/exponential.system.json", stop, solver as { method: string }),
    ),
    "experiments/exponential.run.json",
  );

const post = (outcome: RunOutcome, signalId: string) =>
  outcome.samples
    .filter((sample) => sample.signalId === signalId && sample.side === "post")
    .map((sample) => [format(sample.time), sample.value as number] as const);

const seconds = (time: string) => {
  const [num, den = "1"] = time.split("/");
  return Number(num) / Number(den);
};

const solverSteps = (outcome: RunOutcome) =>
  outcome.trace
    .filter((event) => event.kind === "solver.step")
    .map((event) => [format(event.time), (event.payload as { steps: number }).steps] as const);

it.layer(NodeServices.layer)("hybrid simulation", (it) => {
  it.effect("RK45 meets its tolerance on the decay model and lands exactly on barriers", () =>
    Effect.gen(function* () {
      const { run, resolved } = yield* exponentialRun(yield* loadFiles, -1, [1, 3], [1, 1], {
        method: "rk45-dopri5@1",
        absTol: 1e-10,
        relTol: 1e-10,
      });
      const outcome = simulate(resolved, run, { runId: "rk45" });
      assert.strictEqual(outcome.status, "completed");
      assert.deepStrictEqual(
        solverSteps(outcome).map(([time]) => time),
        ["1/3", "2/3", "1"],
      );
      const x = post(outcome, "x");
      assert.deepStrictEqual(
        x.map(([time]) => time),
        ["0", "1/3", "2/3", "1"],
      );
      for (const [time, value] of x)
        assert.isBelow(Math.abs(value - Math.exp(-seconds(time))), 1e-8, time);
      // The tick samples x(t⁻); the solver stopped exactly there, so nothing was skipped.
      assert.deepStrictEqual(post(outcome, "sampled"), x);
    }),
  );

  it.effect("a barrier inside an RK4 step shortens that step", () =>
    Effect.gen(function* () {
      const { run, resolved } = yield* exponentialRun(yield* loadFiles, -1, [1, 2], [1, 1], {
        method: "rk4-fixed@1",
        fixedStep: { num: "1", den: "3" },
      });
      const outcome = simulate(resolved, run, { runId: "rk4" });
      // [0, 1/2] takes 1/3 then a shortened 1/6; the grid restarts at the barrier.
      assert.deepStrictEqual(solverSteps(outcome), [
        ["1/2", 2],
        ["1", 2],
      ]);
      const growth = (h: number) => 1 - h + h ** 2 / 2 - h ** 3 / 6 + h ** 4 / 24;
      const half = post(outcome, "x").find(([time]) => time === "1/2")![1];
      assert.isBelow(Math.abs(half - growth(1 / 3) * growth(1 / 6)), 1e-15);
    }),
  );

  it.effect("DISC-001 also matches with rk45, and chunking does not change the run", () =>
    Effect.gen(function* () {
      const files = yield* loadFiles;
      const pump = readJson(files, PUMP_RUN);
      const expected = readJson(files, "expected/pump-nominal.trace.json");
      const { run, resolved } = yield* compiledRun(
        withJson(files, PUMP_RUN, {
          ...pump,
          solver: { method: "rk45-dopri5@1", absTol: 1e-9, relTol: 1e-9 },
        }),
        PUMP_RUN,
      );
      const outcome = simulate(resolved, run, { runId: "pump" });
      assert.deepStrictEqual(compareToExpected(outcome, expected), []);

      const chunked = createSimulation(resolved, run, { runId: "pump" });
      let progress = chunked.step(1);
      while (!progress.done) progress = chunked.step(1);
      assert.deepStrictEqual(progress.outcome, outcome);
    }),
  );

  it.effect("the pump trace is identical across repeated runs and reordered sources", () =>
    Effect.gen(function* () {
      const files = yield* loadFiles;
      const first = yield* compiledRun(files, PUMP_RUN);
      const outcome = simulate(first.resolved, first.run, { runId: "pump" });
      assert.deepStrictEqual(simulate(first.resolved, first.run, { runId: "pump" }), outcome);
      const model = readJson(files, "models/pump.system.json");
      const chart = readJson(files, "statecharts/pump.chart.json");
      const reordered = withJson(
        withJson(files, "models/pump.system.json", {
          ...model,
          nodes: model.nodes.toReversed(),
          edges: model.edges.toReversed(),
          outputs: model.outputs.toReversed(),
        }),
        "statecharts/pump.chart.json",
        {
          ...chart,
          states: chart.states.toReversed(),
          transitions: chart.transitions.toReversed(),
        },
      );
      const again = yield* compiledRun(reordered, PUMP_RUN);
      assert.deepStrictEqual(simulate(again.resolved, again.run, { runId: "pump" }), outcome);
    }),
  );

  it.effect("a diverging state is E-NUM-001 and keeps the last committed boundary", () =>
    Effect.gen(function* () {
      const { run, resolved } = yield* exponentialRun(yield* loadFiles, 1000, [1, 2], [10, 1], {
        method: "rk4-fixed@1",
        fixedStep: { num: "1", den: "100" },
      });
      const outcome = simulate(resolved, run, { runId: "diverge" });
      assert.strictEqual(outcome.status, "failed");
      assert.deepStrictEqual(
        outcome.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.elementId]),
        // 1000·x overflows at a stage point before x itself does.
        [["E-NUM-001", "rate"]],
      );
      // RK4 with h·λ = 10 grows ~644× per step: float64 overflows in (1, 3/2).
      assert.strictEqual(format(outcome.lastCommittedTime), "1");
      assert.strictEqual(format(outcome.samples.at(-1)!.time), "1");
      assert.deepStrictEqual(
        outcome.trace.slice(-2).map((event) => [event.kind, format(event.time)]),
        [
          ["diagnostic", "1"],
          ["run.finish", "1"],
        ],
      );
    }),
  );

  it.effect("NUM-001 is within 1e-8 of e^-1, and the step budget is E-NUM-002", () =>
    Effect.gen(function* () {
      const { run, resolved } = yield* compiledRun(
        yield* loadFiles,
        "experiments/exponential-decay.run.json",
      );
      const x = post(simulate(resolved, run, { runId: "decay" }), "x");
      assert.isBelow(Math.abs(x.at(-1)![1] - Math.exp(-1)), 1e-8);
      const limited = simulate(resolved, run, { runId: "decay", maxSolverSteps: 10 });
      assert.strictEqual(limited.status, "failed");
      assert.deepStrictEqual(
        limited.diagnostics.map((diagnostic) => diagnostic.code),
        ["E-NUM-002"],
      );
    }),
  );
});
