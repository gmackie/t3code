import { describe, expect, it } from "vite-plus/test";

import {
  parameterPatch,
  parseParameterDraft,
  semanticChangeSummary,
  systemParameters,
} from "./systemsParameters.ts";

const pump = {
  format: "sw.system",
  nodes: [
    { id: "inlet", type: "std.constant@1", parameters: { value: 2, unit: "m3/s" } },
    {
      id: "tank",
      type: "std.integrator@1",
      parameters: { "initial/level": 0.5, enabled: true, limits: { min: 0, max: 4 } },
    },
  ],
};

describe("systemParameters", () => {
  it("addresses each scalar parameter by an escaped pointer and keeps structured ones read-only", () => {
    const [inlet, tank] = systemParameters(pump);
    expect(inlet!.editable.map((parameter) => parameter.pointer)).toEqual([
      "/nodes/0/parameters/value",
      "/nodes/0/parameters/unit",
    ]);
    expect(tank!.editable.map((parameter) => [parameter.pointer, parameter.value])).toEqual([
      ["/nodes/1/parameters/initial~1level", 0.5],
      ["/nodes/1/parameters/enabled", true],
    ]);
    expect(tank!.fixed).toEqual([{ key: "limits", json: '{"min":0,"max":4}' }]);
  });

  it("finds nothing to edit in documents that are not systems", () => {
    expect(systemParameters({ format: "sw.statechart", nodes: pump.nodes })).toEqual([]);
    expect(systemParameters(null)).toEqual([]);
  });
});

describe("parseParameterDraft", () => {
  it("keeps the parameter's type", () => {
    expect(parseParameterDraft(1, " 2.5 ")).toEqual({ value: 2.5 });
    expect(parseParameterDraft(1, "")).toEqual({ error: "Enter a finite number" });
    expect(parseParameterDraft(1, "Infinity")).toEqual({ error: "Enter a finite number" });
    expect(parseParameterDraft(false, "true")).toEqual({ value: true });
    expect(parseParameterDraft(false, "yes")).toEqual({ error: "Enter true or false" });
    expect(parseParameterDraft("m", " cm ")).toEqual({ value: " cm " });
  });
});

describe("parameterPatch", () => {
  it("replaces only the parameters whose draft changed", () => {
    const parameters = systemParameters(pump).flatMap((node) => node.editable);
    const drafts = new Map<string, number | boolean | string>([
      ["/nodes/0/parameters/value", 2],
      ["/nodes/1/parameters/initial~1level", 1],
    ]);
    expect(parameterPatch(parameters, drafts)).toEqual([
      { op: "replace", path: "/nodes/1/parameters/initial~1level", value: 1 },
    ]);
  });
});

describe("semanticChangeSummary", () => {
  it("lists what changed by element kind and skips empty kinds", () => {
    const digest = `sha256:${"0".repeat(64)}`;
    expect(
      semanticChangeSummary({
        format: "sw.system",
        beforeDigest: digest,
        afterDigest: digest,
        changes: {
          nodes: { added: [], removed: [], changed: ["tank"] },
          edges: { added: [], removed: [], changed: [] },
          parameters: { added: ["gain"], removed: ["bias"], changed: [] },
        },
      }),
    ).toEqual(["nodes changed: tank", "parameters added: gain", "parameters removed: bias"]);
    expect(semanticChangeSummary(undefined)).toEqual([]);
  });
});
