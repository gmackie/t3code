import { assert, describe, it } from "@effect/vitest";
import type { ChartDocument, SystemDocument } from "@t3tools/systems-model/documents";

import pumpChartJson from "../../systems-model/fixtures/conformance-v0.1/statecharts/pump.chart.json" with { type: "json" };
import pumpJson from "../../systems-model/fixtures/conformance-v0.1/models/pump.system.json" with { type: "json" };
import { semanticDiff } from "./diff.ts";

const pump = pumpJson as SystemDocument;
const pumpChart = pumpChartJson as ChartDocument;
const clone = <A>(value: A): any => structuredClone(value);

describe("semanticDiff", () => {
  it("is empty for reordering and retitling", () => {
    const system = clone(pump);
    system.nodes.reverse();
    system.edges.reverse();
    system.title = "Another name";
    const chart = clone(pumpChart);
    chart.states.reverse();
    chart.transitions.reverse();
    assert.deepStrictEqual(semanticDiff(pump, system), {});
    assert.deepStrictEqual(semanticDiff(pumpChart, chart), {});
  });

  it("names changed parameters, added and removed elements by kind", () => {
    const system = clone(pump);
    system.nodes[2].parameters.initial = 0.5;
    system.edges = system.edges.filter((edge: { id: string }) => edge.id !== "e.inlet");
    system.outputs.push({ id: "flow", source: { node: "net_flow", port: "value" } });
    assert.deepStrictEqual(semanticDiff(pump, system), {
      nodes: { added: [], removed: [], changed: ["tank"] },
      edges: { added: [], removed: ["e.inlet"], changed: [] },
      outputs: { added: ["flow"], removed: [], changed: [] },
      parameters: { added: [], removed: [], changed: ["tank.initial"] },
    });
  });

  it("reports chart transitions and interface variables", () => {
    const chart = clone(pumpChart);
    chart.transitions[1].priority = 20;
    chart.interface.inputs[0].unit = "s";
    assert.deepStrictEqual(semanticDiff(pumpChart, chart), {
      interface: { added: [], removed: [], changed: ["input.level"] },
      transitions: { added: [], removed: [], changed: ["tr.on_off"] },
    });
  });
});
