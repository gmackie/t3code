import { assert, describe, it } from "@effect/vitest";

import catalogJson from "../fixtures/conformance-v0.1/libraries/std.blocks.json" with { type: "json" };
import decayJson from "../fixtures/conformance-v0.1/models/exponential-decay.system.json" with { type: "json" };
import pumpJson from "../fixtures/conformance-v0.1/models/pump.system.json" with { type: "json" };
import badUnitsJson from "../fixtures/conformance-v0.1/negative/invalid-units.system.json" with { type: "json" };
import hierarchyJson from "../fixtures/conformance-v0.1/statecharts/hierarchy.chart.json" with { type: "json" };
import pumpChartJson from "../fixtures/conformance-v0.1/statecharts/pump.chart.json" with { type: "json" };
import timerJson from "../fixtures/conformance-v0.1/statecharts/timer.chart.json" with { type: "json" };
import zeroTimeJson from "../fixtures/conformance-v0.1/statecharts/zero-time-cycle.chart.json" with { type: "json" };
import {
  decodeDocument,
  validateChart,
  validateSystem,
  type DocumentFormat,
  type DocumentOf,
} from "./validate.ts";

const load = <F extends DocumentFormat>(format: F, json: unknown): DocumentOf<F> => {
  const decoded = decodeDocument(format, json);
  assert.deepStrictEqual(decoded.diagnostics, []);
  return decoded.value!;
};

const catalog = load("sw.blockCatalog", catalogJson);
const pump = load("sw.system", pumpJson);
const pumpChart = load("sw.statechart", pumpChartJson);
const hierarchy = load("sw.statechart", hierarchyJson);

const codes = (
  diagnostics: ReadonlyArray<{ readonly code: string; readonly elementId?: string }>,
) => diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.elementId]);

const reversed = <A>(items: ReadonlyArray<A>) => items.toReversed();

describe("decodeDocument", () => {
  it("rejects unknown fields instead of ignoring them", () => {
    const input = structuredClone(pumpJson) as { nodes: Array<Record<string, unknown>> };
    input.nodes[2]!.solver = "euler";
    const decoded = decodeDocument("sw.system", input);
    assert.isUndefined(decoded.value);
    assert.deepStrictEqual(
      decoded.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.pointer]),
      [["E-SCHEMA-001", "/nodes/2/solver"]],
    );
  });

  it("refuses a newer semantics version rather than guessing", () => {
    const decoded = decodeDocument("sw.statechart", { ...pumpChart, semanticsVersion: "0.2" });
    assert.deepStrictEqual(
      decoded.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.pointer]),
      [["E-SCHEMA-001", "/semanticsVersion"]],
    );
  });
});

describe("validateSystem", () => {
  it("accepts a feedback loop broken by an integrator", () => {
    assert.deepStrictEqual(validateSystem(pump, { catalog }), []);
  });

  it("requires reduced, positive clock periods", () => {
    const system = {
      ...pump,
      clocks: [
        { ...pump.clocks[0]!, period: { num: "2", den: "2" } },
        { ...pump.clocks[0]!, id: "clock.zero", period: { num: "0", den: "1" } },
      ],
    };
    assert.deepStrictEqual(codes(validateSystem(system, { catalog })), [
      ["E-TIME-001", "clock.control"],
      ["E-TIME-001", "clock.zero"],
    ]);
  });

  it("rejects driving from an input and driving one input twice", () => {
    const system = {
      ...pump,
      edges: [
        ...pump.edges,
        {
          id: "e.backwards",
          kind: "signal" as const,
          from: { node: "net_flow", port: "a" },
          to: { node: "tank", port: "derivative" },
        },
      ],
    };
    assert.deepStrictEqual(codes(validateSystem(system, { catalog })), [
      ["E-TYPE-001", "e.backwards"],
      ["E-TYPE-001", "e.backwards"],
    ]);
  });

  it("reports an algebraic loop once the integrator breaking it becomes a gain", () => {
    const decay = load("sw.system", decayJson);
    const system = {
      ...decay,
      nodes: decay.nodes.map((node) =>
        node.id === "state"
          ? { id: "state", type: "std.gain@1", parameters: { gain: 1, gainUnit: "1" } }
          : node,
      ),
      edges: decay.edges.map((edge) =>
        edge.to.node === "state" ? { ...edge, to: { node: "state", port: "value" } } : edge,
      ),
    };
    assert.deepStrictEqual(validateSystem(decay, { catalog }), []);
    const [loop, ...rest] = validateSystem(system, { catalog });
    assert.deepStrictEqual(rest, []);
    assert.strictEqual(loop?.code, "E-ALG-001");
    assert.deepStrictEqual(
      loop?.related?.map((entry) => entry.elementId),
      ["rate", "state", "e.derivative", "e.state"],
    );
  });

  it("does not depend on declaration order", () => {
    const system = load("sw.system", badUnitsJson);
    const shuffled = {
      ...system,
      nodes: reversed(system.nodes),
      edges: reversed(system.edges),
      clocks: reversed(system.clocks),
    };
    const original = validateSystem(system, { catalog });
    assert.isNotEmpty(original);
    assert.deepStrictEqual(codes(validateSystem(shuffled, { catalog })), codes(original));
  });
});

describe("validateChart", () => {
  it("accepts the fixture charts", () => {
    for (const json of [pumpChartJson, hierarchyJson, timerJson, zeroTimeJson])
      assert.deepStrictEqual(validateChart(load("sw.statechart", json)), [], json.id);
  });

  it("requires distinct priorities for one source and trigger, even with exclusive guards", () => {
    const chart = {
      ...pumpChart,
      transitions: [
        ...pumpChart.transitions,
        { ...pumpChart.transitions[0]!, id: "tr.off_on_again" },
      ],
    };
    assert.deepStrictEqual(codes(validateChart(chart)), [["E-CHART-002", "tr.off_on_again"]]);
  });

  it("requires every compound state to enter a child of its own", () => {
    const chart = {
      ...hierarchy,
      states: hierarchy.states.map((state) =>
        state.id === "state.normal" ? { ...state, initial: "state.off" } : state,
      ),
    };
    assert.deepStrictEqual(codes(validateChart(chart)), [["E-CHART-001", "state.normal"]]);
  });

  it("rejects parent cycles that never reach the root", () => {
    const chart = {
      ...hierarchy,
      states: [
        ...hierarchy.states,
        {
          id: "state.loop_a",
          type: "compound" as const,
          parent: "state.loop_b",
          initial: "state.loop_b",
        },
        {
          id: "state.loop_b",
          type: "compound" as const,
          parent: "state.loop_a",
          initial: "state.loop_a",
        },
      ],
    };
    assert.deepStrictEqual(codes(validateChart(chart)), [
      ["E-CHART-001", "state.loop_a"],
      ["E-CHART-001", "state.loop_b"],
    ]);
  });

  it("only lets guards read and actions write declared variables", () => {
    const chart = {
      ...pumpChart,
      states: pumpChart.states.map((state) =>
        state.id === "state.on"
          ? {
              ...state,
              entry: [
                {
                  op: "assign" as const,
                  target: "input.level",
                  value: { op: "ref" as const, path: "context.tank" },
                },
              ],
            }
          : state,
      ),
    };
    assert.deepStrictEqual(
      validateChart(chart).map((diagnostic) => [diagnostic.code, diagnostic.pointer]),
      [
        ["E-REF-001", "/states/2/entry/0/value/path"],
        ["E-TYPE-001", "/states/2/entry/0"],
      ],
    );
  });
});
