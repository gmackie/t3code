import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { readPackFiles, validatePack, type Pack } from "@t3tools/systems-model/pack";

import { compareChartTrace, runChartExperiment } from "./experiment.ts";

const FIXTURES = new URL("../../systems-model/fixtures/conformance-v0.1/", import.meta.url);

const loadPack = Effect.gen(function* () {
  const root = yield* (yield* Path.Path).fromFileUrl(FIXTURES);
  const pack = yield* validatePack(yield* readPackFiles(root));
  assert.deepStrictEqual(
    pack.diagnostics.filter((diagnostic) => !diagnostic.file?.startsWith("negative/")),
    [],
  );
  return pack;
});

/** Run a manifest fixture through the chart driver. */
const execute = (pack: Pack, fixtureId: string) => {
  const manifest = pack.documents.get("manifest.json");
  if (manifest?.format !== "sw.conformancePack") return assert.fail("manifest did not load");
  const fixture = manifest.value.fixtures.find((candidate) => candidate.id === fixtureId);
  const run = fixture === undefined ? undefined : pack.documents.get(fixture.source);
  if (fixture === undefined || run?.format !== "sw.run") return assert.fail(`${fixtureId} run`);
  const chart = pack.documents.get(run.value.chartRef ?? "");
  if (chart?.format !== "sw.statechart") return assert.fail(`${fixtureId} chart`);
  const expected =
    fixture.expected === undefined ? undefined : pack.documents.get(fixture.expected);
  return {
    fixture,
    outcome: runChartExperiment(chart.value, run.value, { runId: fixtureId }),
    expected: expected?.format === "sw.expectedTrace" ? expected.value : undefined,
  };
};

it.layer(NodeServices.layer)("chart conformance fixtures", (it) => {
  it.effect.each(["CHART-001", "CHART-002"])("%s matches its expected trace", (fixtureId) =>
    Effect.gen(function* () {
      const { outcome, expected } = execute(yield* loadPack, fixtureId);
      if (expected === undefined) return assert.fail("no expected trace");
      assert.strictEqual(outcome.status, "completed");
      assert.deepStrictEqual(compareChartTrace(outcome, expected), []);
    }),
  );

  it.effect("CHART-001 exits the child before its parent and enters only the target", () =>
    Effect.gen(function* () {
      const { outcome } = execute(yield* loadPack, "CHART-001");
      const atOne = outcome.trace.filter((event) => event.time.num === "1");
      assert.deepStrictEqual(
        atOne.map((event) => [event.kind, event.entityId]),
        [
          ["event.consume", "overload"],
          ["state.exit", "state.running"],
          ["state.exit", "state.normal"],
          ["transition.fire", "tr.child_to_fault"],
          ["state.enter", "state.fault"],
        ],
      );
    }),
  );

  it.effect("compareChartTrace reports a run that diverges from the expectation", () =>
    Effect.gen(function* () {
      const { outcome, expected } = execute(yield* loadPack, "CHART-002");
      if (expected === undefined) return assert.fail("no expected trace");
      // Drop the timeout so the chart stays armed.
      const truncated = {
        ...outcome,
        trace: outcome.trace.filter((event) => event.time.den !== "2"),
      };
      assert.deepStrictEqual(compareChartTrace(truncated, expected), [
        "t=5/2: active state state.armed, expected state.expired",
        "t=5/2: fired [], expected [tr.timeout]",
        "t=5/2: tr.timeout did not fire",
      ]);
    }),
  );

  it.effect("TIME-001 fails with E-TIME-002, keeps the partial trace and names the cycle", () =>
    Effect.gen(function* () {
      const { fixture, outcome } = execute(yield* loadPack, "TIME-001");
      assert.strictEqual(outcome.status, "failed");
      assert.deepStrictEqual(
        outcome.diagnostics.map((diagnostic) => diagnostic.code),
        [fixture.expectedDiagnostic],
      );
      const [diagnostic] = outcome.diagnostics;
      assert.deepStrictEqual(
        diagnostic?.related?.map((entry) => entry.elementId),
        ["state.b", "state.a", "tr.a_b", "tr.b_a"],
      );
      const fired = outcome.trace.filter((event) => event.kind === "transition.fire");
      assert.strictEqual(fired.length, 1024);
      assert.strictEqual(fired.at(-1)?.microstep, 1024);
      assert.deepStrictEqual(
        outcome.trace.slice(-2).map((event) => event.kind),
        ["diagnostic", "run.finish"],
      );
      assert.deepStrictEqual(
        outcome.trace.map((event) => event.sequence),
        outcome.trace.map((_, index) => String(index)),
      );
    }),
  );
});
