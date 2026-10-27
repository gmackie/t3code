import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import { readPackFiles, validatePack, type PackFiles } from "@t3tools/systems-model/pack";

import { compileChart, compileSystem, type ResolvedSystem } from "./compile.ts";

const FIXTURES = new URL("../../systems-model/fixtures/conformance-v0.1/", import.meta.url);
const PUMP = "models/pump.system.json";
const PUMP_CHART = "statecharts/pump.chart.json";

const loadFiles = Effect.gen(function* () {
  const root = yield* (yield* Path.Path).fromFileUrl(FIXTURES);
  return yield* readPackFiles(root);
});

const read = (files: PackFiles, file: string) =>
  JSON.parse(new TextDecoder().decode(files.files.get(file)!));

/** Rewrite (or add) one file; `pretty` re-serializes with different whitespace. */
const withFile = (
  files: PackFiles,
  file: string,
  edit: (json: any) => unknown,
  pretty = false,
): PackFiles => {
  const json = files.files.has(file) ? read(files, file) : undefined;
  const next = edit(json) ?? json;
  const text = pretty ? JSON.stringify(next, null, 3) : JSON.stringify(next);
  return { ...files, files: new Map(files.files).set(file, new TextEncoder().encode(text)) };
};

const compile = (files: PackFiles, entry = PUMP) =>
  Effect.gen(function* () {
    return yield* compileSystem(yield* validatePack(files), entry);
  });

const compiled = (files: PackFiles, entry = PUMP) =>
  Effect.gen(function* () {
    const result = yield* compile(files, entry);
    assert.deepStrictEqual(result.diagnostics, [], entry);
    return result.resolved!;
  });

const codes = (result: {
  readonly diagnostics: ReadonlyArray<{ readonly code: string; readonly elementId?: string }>;
}) => result.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.elementId]);

const reverseKeys = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(reverseKeys)
    : typeof value === "object" && value !== null
      ? Object.fromEntries(
          Object.entries(value)
            .toReversed()
            .map(([k, v]) => [k, reverseKeys(v)]),
        )
      : value;

it.layer(NodeServices.layer)("compileSystem", (it) => {
  it.effect("every positive conformance model and chart compiles with no diagnostics", () =>
    Effect.gen(function* () {
      const files = yield* loadFiles;
      const pack = yield* validatePack(files);
      const project = read(files, "systems.project.json");
      for (const entry of project.entrypoints) {
        const result = yield* compileSystem(pack, entry);
        assert.deepStrictEqual(result.diagnostics, [], entry);
        assert.isDefined(result.resolved, entry);
      }
      for (const chart of [...files.files.keys()].filter((file) => file.endsWith(".chart.json"))) {
        const result = yield* compileChart(pack, chart);
        assert.deepStrictEqual(result.diagnostics, [], chart);
        assert.match(result.resolved!.semanticDigest, /^sha256:[0-9a-f]{64}$/);
      }
    }),
  );

  it.effect("each negative fixture reports exactly its manifest code", () =>
    Effect.gen(function* () {
      const files = yield* loadFiles;
      assert.deepStrictEqual(codes(yield* compile(files, "negative/invalid-units.system.json")), [
        ["E-UNIT-001", "bad_unit_conversion"],
      ]);
      const loop = yield* compile(files, "negative/algebraic-loop.system.json");
      assert.deepStrictEqual(codes(loop), [["E-ALG-001", "a"]]);
      assert.deepStrictEqual(
        loop.diagnostics[0]?.related?.map((entry) => entry.elementId),
        ["a", "b", "e.a_to_b", "e.b_to_a"],
      );
    }),
  );

  it.effect("schedules the pump: sample, chart, downstream logic, then the staged hold", () =>
    Effect.gen(function* () {
      const pump = yield* compiled(yield* loadFiles);
      assert.deepStrictEqual(pump.clockSchedules["clock.control"], [
        { node: "level_sampler", action: "sample" },
        { node: "controller", action: "chart" },
        { node: "command_numeric", action: "evaluate" },
        { node: "pump_gain", action: "evaluate" },
        { node: "pump_hold", action: "stage" },
      ]);
      assert.deepStrictEqual(pump.continuousOrder, ["inlet", "net_flow", "tank"]);
      assert.deepStrictEqual(pump.nodes.pump_gain?.outputs.value, {
        unit: "m/s",
        valueType: "float64",
        domain: "clocked:clock.control",
      });
      assert.deepStrictEqual(pump.nodes.net_flow?.inputs.b, {
        unit: "m/s",
        valueType: "float64",
        domain: "continuous",
        edge: "e.pump_out",
        from: { node: "pump_hold", port: "value" },
      });
      assert.strictEqual(pump.charts.controller?.chart.id, "pump.chart");
      assert.deepStrictEqual(pump.sourceMap.edges["e.flow"], { file: PUMP, pointer: "/edges/1" });
      // Plain data: it survives a worker-thread or wire round trip unchanged.
      assert.deepStrictEqual(JSON.parse(JSON.stringify(pump)) as ResolvedSystem, pump);
    }),
  );

  it.effect("resolved probe units match every expected trace", () =>
    Effect.gen(function* () {
      const files = yield* loadFiles;
      for (const file of [...files.files.keys()].filter((name) => name.startsWith("expected/"))) {
        const trace = read(files, file);
        const run = read(files, trace.runRef);
        if (run.modelRef === undefined) continue;
        const system = yield* compiled(files, run.modelRef);
        const units = Object.fromEntries(system.outputs.map((output) => [output.id, output.unit]));
        for (const observation of trace.observations)
          for (const [probe, signal] of Object.entries<{ unit: string }>(observation.signals))
            assert.strictEqual(units[probe], signal.unit, `${file} ${probe}`);
      }
    }),
  );

  it.effect(
    "a hold breaks an instantaneous loop even though the catalog marks it feedthrough",
    () =>
      Effect.gen(function* () {
        const loop = {
          format: "sw.system",
          schemaVersion: "0.1.0",
          semanticsVersion: "0.1",
          id: "loop.held",
          clocks: [
            {
              id: "c",
              kind: "periodic",
              period: { num: "1", den: "1" },
              offset: { num: "0", den: "1" },
              priority: 1,
            },
          ],
          nodes: [
            { id: "hold", type: "std.hold@1", parameters: { clock: "c", initial: 0, unit: "1" } },
            { id: "plant", type: "std.gain@1", parameters: { gain: 2 } },
            { id: "sample", type: "std.sample@1", parameters: { clock: "c", unit: "1" } },
            { id: "control", type: "std.gain@1", parameters: { gain: -1 } },
          ],
          edges: [
            ["e1", "hold", "plant"],
            ["e2", "plant", "sample"],
            ["e3", "sample", "control"],
            ["e4", "control", "hold"],
          ].map(([id, from, to]) => ({
            id,
            kind: "signal",
            from: { node: from, port: "value" },
            to: { node: to, port: "value" },
          })),
        };
        const system = yield* compiled(
          withFile(yield* loadFiles, "models/loop.system.json", () => loop),
          "models/loop.system.json",
        );
        assert.deepStrictEqual(system.continuousOrder, ["plant"]);
        assert.strictEqual(system.nodes.plant?.outputs.value?.domain, "continuous");
        assert.deepStrictEqual(
          system.clockSchedules.c?.map((step) => step.node),
          ["sample", "control", "hold"],
        );
      }),
  );

  it.effect("an implicit continuous-to-clocked edge is E-CLOCK-001 with a sample fix", () =>
    Effect.gen(function* () {
      const files = withFile(yield* loadFiles, PUMP, (pump) => {
        pump.nodes = pump.nodes.filter((node: any) => node.id !== "level_sampler");
        pump.edges = pump.edges.filter((edge: any) => edge.id !== "e.level_sample");
        pump.edges.find((edge: any) => edge.id === "e.controller_level").from = {
          node: "tank",
          port: "value",
        };
      });
      const result = yield* compile(files);
      assert.deepStrictEqual(codes(result), [["E-CLOCK-001", "e.controller_level"]]);
      const [diagnostic] = result.diagnostics;
      assert.strictEqual(diagnostic?.file, PUMP);
      assert.strictEqual(diagnostic?.pointer, "/edges/2");
      assert.strictEqual(diagnostic?.fix?.kind, "insert-block");
      assert.include(diagnostic?.fix?.explanation, "std.sample@1");
      assert.include(diagnostic?.fix?.explanation, "clock.control");
    }),
  );

  it.effect("reports a unit mismatch on the edge and a value-type mismatch in one pass", () =>
    Effect.gen(function* () {
      const files = withFile(yield* loadFiles, PUMP, (pump) => {
        pump.nodes.find((node: any) => node.id === "pump_gain").parameters.gainUnit = "m";
        // The chart's bool output now drives a numeric gain directly.
        pump.edges.find((edge: any) => edge.id === "e.to_gain").from = {
          node: "controller",
          port: "pump_enabled",
        };
      });
      const result = yield* compile(files);
      assert.deepStrictEqual(codes(result), [
        ["E-TYPE-001", "e.to_gain"],
        ["E-UNIT-001", "e.to_hold"],
      ]);
      assert.include(result.diagnostics[1]?.message, "carries m but pump_hold.value expects m/s");
    }),
  );

  it.effect("a dimensionless guard literal against a metre input is E-UNIT-001 in the chart", () =>
    Effect.gen(function* () {
      const files = withFile(yield* loadFiles, PUMP_CHART, (chart) => {
        delete chart.transitions[0].guard.right.unit;
      });
      const pack = yield* validatePack(files);
      for (const result of [
        yield* compileChart(pack, PUMP_CHART),
        yield* compileSystem(pack, PUMP),
      ])
        assert.deepStrictEqual(
          result.diagnostics.map((d) => [d.code, d.file, d.elementId, d.pointer]),
          [["E-UNIT-001", PUMP_CHART, "tr.off_on", "/transitions/0/guard"]],
        );
    }),
  );

  it.effect("a locked block type with no compiler semantics is E-TARGET-001", () =>
    Effect.gen(function* () {
      const library = "libraries/std.blocks.json";
      let files = withFile(yield* loadFiles, library, (catalog) => {
        catalog.blockTypes.push({
          type: "std.pid@1",
          stateKind: "clocked",
          inputs: [],
          outputs: ["value"],
          feedthrough: false,
        });
      });
      const bytes = yield* (yield* Crypto.Crypto).digest("SHA-256", files.files.get(library)!);
      const sha256 = Buffer.from(bytes).toString("hex");
      files = withFile(files, "systems.lock.json", (lock) => {
        lock.libraries[0].sha256 = sha256;
      });
      files = withFile(files, PUMP, (pump) => {
        pump.nodes.push({ id: "pid", type: "std.pid@1", parameters: {} });
      });
      const result = yield* compile(files);
      assert.deepStrictEqual(
        result.diagnostics.map((d) => [d.code, d.pointer]),
        [["E-TARGET-001", "/nodes/8/type"]],
      );
    }),
  );

  it.effect("block parameters are checked strictly against the block's semantics", () =>
    Effect.gen(function* () {
      const files = withFile(yield* loadFiles, PUMP, (pump) => {
        pump.nodes.find((node: any) => node.id === "pump_gain").parameters.gian = 2;
      });
      assert.deepStrictEqual(
        (yield* compile(files)).diagnostics.map((d) => [d.code, d.pointer]),
        [["E-SCHEMA-001", "/nodes/6/parameters/gian"]],
      );
    }),
  );
});

it.layer(NodeServices.layer)("semantic digest", (it) => {
  const digests = (files: PackFiles) =>
    Effect.gen(function* () {
      const { semanticDigest, planDigest } = yield* compiled(files);
      return { semanticDigest, planDigest };
    });

  it.effect("ignores ordering, formatting, titles, explicit defaults and layout", () =>
    Effect.gen(function* () {
      const files = yield* loadFiles;
      const baseline = yield* digests(files);
      let edited = withFile(
        files,
        PUMP,
        (pump) => {
          pump.nodes.reverse();
          pump.edges.reverse();
          pump.outputs.reverse();
          pump.title = "Renamed";
          return reverseKeys(pump);
        },
        true,
      );
      edited = withFile(edited, PUMP_CHART, (chart) => {
        chart.states.reverse();
        chart.transitions.reverse();
        chart.states[0].exit = [];
        return reverseKeys(chart);
      });
      edited = withFile(edited, "models/pump.layout.json", (layout) => {
        layout.positions.tank = { x: -999, y: 42 };
        layout.viewport.zoom = 2;
      });
      assert.deepStrictEqual(yield* digests(edited), baseline);
      assert.notStrictEqual(baseline.semanticDigest, baseline.planDigest);
    }),
  );

  it.effect("an omitted semantic default digests like the explicit default", () =>
    Effect.gen(function* () {
      const files = yield* loadFiles;
      const entry = "models/cross-clock.system.json";
      const explicit = (yield* compiled(files, entry)).semanticDigest;
      const omitted = withFile(files, entry, (system) => {
        delete system.nodes[1].parameters.policy;
      });
      assert.strictEqual((yield* compiled(omitted, entry)).semanticDigest, explicit);
    }),
  );

  it.effect("changes under any semantic edit", () =>
    Effect.gen(function* () {
      const files = yield* loadFiles;
      const baseline = (yield* digests(files)).semanticDigest;
      const edits: ReadonlyArray<readonly [string, string, (json: any) => void]> = [
        [
          "parameter value",
          PUMP,
          (pump) => {
            pump.nodes[2].parameters.initial = 0.5;
          },
        ],
        [
          "clock priority",
          PUMP,
          (pump) => {
            pump.clocks[0].priority = 5;
          },
        ],
        [
          "transition priority",
          PUMP_CHART,
          (chart) => {
            chart.transitions[0].priority = 20;
          },
        ],
        [
          "edge endpoint",
          PUMP,
          (pump) => {
            pump.edges[0].to.port = "b";
            pump.edges[7].to.port = "a";
          },
        ],
      ];
      const seen = new Set([baseline]);
      for (const [label, file, edit] of edits) {
        const { semanticDigest } = yield* digests(withFile(files, file, edit));
        assert.isFalse(seen.has(semanticDigest), label);
        seen.add(semanticDigest);
      }
    }),
  );
});
