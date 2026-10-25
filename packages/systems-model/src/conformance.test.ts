import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { diagnosticsFor, readPackFiles, validatePack, type Pack, type PackFiles } from "./pack.ts";
import { toRational } from "./rational.ts";

const FIXTURES = new URL("../fixtures/conformance-v0.1/", import.meta.url);

/** Diagnostics produced by static validation alone; the rest need an interpreter (RFC-001 PR 3+). */
const STATIC_CODES = new Set([
  "E-SCHEMA-001",
  "E-REF-001",
  "E-TYPE-001",
  "E-UNIT-001",
  "E-ALG-001",
  "E-CHART-001",
  "E-CHART-002",
  "E-TIME-001",
]);

const loadPack = Effect.gen(function* () {
  const root = yield* (yield* Path.Path).fromFileUrl(FIXTURES);
  const files = yield* readPackFiles(root);
  return { files, pack: yield* validatePack(files) };
});

const document = (pack: Pack, file: string) => {
  const loaded = pack.documents.get(file);
  if (loaded === undefined) return assert.fail(`${file} did not load`);
  return loaded;
};

const withFile = (files: PackFiles, file: string, edit: (json: any) => void): PackFiles => {
  const json = JSON.parse(new TextDecoder().decode(files.files.get(file)!));
  edit(json);
  return {
    ...files,
    files: new Map(files.files).set(file, new TextEncoder().encode(JSON.stringify(json))),
  };
};

it.layer(NodeServices.layer)("conformance pack v0.1", (it) => {
  it.effect("only the deliberately invalid models have diagnostics", () =>
    Effect.gen(function* () {
      const { pack } = yield* loadPack;
      const files = new Set(pack.diagnostics.map((diagnostic) => diagnostic.file));
      assert.deepStrictEqual([...files].toSorted(), [
        "negative/algebraic-loop.system.json",
        "negative/invalid-units.system.json",
      ]);
    }),
  );

  it.effect("each manifest fixture expecting a static diagnostic reports exactly that code", () =>
    Effect.gen(function* () {
      const { pack } = yield* loadPack;
      const manifest = document(pack, "manifest.json");
      if (manifest.format !== "sw.conformancePack") return assert.fail("not a manifest");
      for (const fixture of manifest.value.fixtures) {
        const codes = diagnosticsFor(pack, fixture.source).map((diagnostic) => diagnostic.code);
        const expected =
          fixture.expectedDiagnostic !== undefined && STATIC_CODES.has(fixture.expectedDiagnostic)
            ? [fixture.expectedDiagnostic]
            : [];
        assert.deepStrictEqual(codes, expected, fixture.id);
      }
    }),
  );

  it.effect("TYPE-001 names the impossible conversion and the edge feeding it", () =>
    Effect.gen(function* () {
      const { pack } = yield* loadPack;
      const [diagnostic] = diagnosticsFor(pack, "negative/invalid-units.system.json");
      assert.strictEqual(diagnostic?.code, "E-UNIT-001");
      assert.strictEqual(diagnostic?.elementId, "bad_unit_conversion");
      assert.deepStrictEqual(diagnostic?.related, [{ elementId: "e.bad_units" }]);
    }),
  );

  it.effect("GRAPH-001 reports the strongly connected component", () =>
    Effect.gen(function* () {
      const { pack } = yield* loadPack;
      const [diagnostic] = diagnosticsFor(pack, "negative/algebraic-loop.system.json");
      assert.strictEqual(diagnostic?.code, "E-ALG-001");
      assert.deepStrictEqual(
        diagnostic?.related?.map((entry) => entry.elementId),
        ["a", "b", "e.a_to_b", "e.b_to_a"],
      );
    }),
  );

  it.effect("a library whose bytes no longer match the lock is refused", () =>
    Effect.gen(function* () {
      const { files } = yield* loadPack;
      const pack = yield* validatePack(
        withFile(files, "libraries/std.blocks.json", (json) => {
          json.version = "0.1.1";
        }),
      );
      const lock = pack.diagnostics.filter((diagnostic) => diagnostic.file === "systems.lock.json");
      assert.deepStrictEqual(
        lock.map((diagnostic) => [diagnostic.code, diagnostic.pointer]),
        [["E-REF-001", "/libraries/0/sha256"]],
      );
      // Without a verified library, no system can resolve its blocks.
      assert.isTrue(
        pack.diagnostics.some(
          (diagnostic) =>
            diagnostic.file === "models/pump.system.json" && diagnostic.code === "E-REF-001",
        ),
      );
    }),
  );

  it.effect("references cannot leave the project root", () =>
    Effect.gen(function* () {
      const { files } = yield* loadPack;
      const pack = yield* validatePack(
        withFile(files, "experiments/pump-nominal.run.json", (json) => {
          json.modelRef = "../models/pump.system.json";
        }),
      );
      assert.deepStrictEqual(
        diagnosticsFor(pack, "experiments/pump-nominal.run.json").map((d) => [d.code, d.pointer]),
        [["E-REF-001", "/modelRef"]],
      );
    }),
  );

  it.effect("expected traces may only name states, transitions and probes that exist", () =>
    Effect.gen(function* () {
      const { files } = yield* loadPack;
      const pack = yield* validatePack(
        withFile(files, "expected/hierarchy.trace.json", (json) => {
          json.observations[1].activeState = "state.faulted";
          json.expectedTransitions[0].exit = ["state.running", "state.nominal"];
        }),
      );
      assert.deepStrictEqual(
        diagnosticsFor(pack, "expected/hierarchy.trace.json").map((d) => d.pointer),
        ["/observations/1/activeState", "/expectedTransitions/0/exit/1"],
      );
    }),
  );
});

describe("DISC-001 expected trace", () => {
  // Independent hand model of RFC-001 §14.2: a command applies to the next interval.
  it.effect("matches the piecewise-linear pump trajectory", () =>
    Effect.gen(function* () {
      const { pack } = yield* loadPack;
      const trace = document(pack, "expected/pump-nominal.trace.json");
      if (trace.format !== "sw.expectedTrace") return assert.fail("not a trace");
      let level = 0;
      let pump = false;
      for (const observation of trace.value.observations) {
        if (toRational(observation.time).num > 0n) level += pump ? -2 : 1;
        assert.closeTo(
          Number(observation.signals.level?.value),
          level,
          trace.value.numericAbsTolerance,
        );
        if (pump && level <= 1) pump = false;
        else if (!pump && level >= 3) pump = true;
        assert.strictEqual(observation.signals.pump_enabled?.value, pump);
        assert.strictEqual(observation.activeState, pump ? "state.on" : "state.off");
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
