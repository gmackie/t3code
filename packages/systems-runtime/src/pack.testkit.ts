import { assert } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import { compileChart, compileSystem } from "@t3tools/systems-compiler/compile";
import type { RunDocument } from "@t3tools/systems-model/documents";
import { readPackFiles, validatePack, type PackFiles } from "@t3tools/systems-model/pack";

/** The conformance pack, plus in-memory edits for models the fixtures do not cover. */

const FIXTURES = new URL("../../systems-model/fixtures/conformance-v0.1/", import.meta.url);

export const loadFiles = Effect.gen(function* () {
  return yield* readPackFiles(yield* (yield* Path.Path).fromFileUrl(FIXTURES));
});

export const readJson = (files: PackFiles, file: string) =>
  JSON.parse(new TextDecoder().decode(files.files.get(file)!));

export const withJson = (files: PackFiles, file: string, value: unknown): PackFiles => ({
  ...files,
  files: new Map(files.files).set(file, new TextEncoder().encode(JSON.stringify(value))),
});

const rational = (num: number, den = 1) => ({ num: String(num), den: String(den) });

export const clock = (id: string, period: [number, number], priority: number) => ({
  id,
  kind: "periodic",
  period: rational(...period),
  offset: rational(0),
  priority,
});

export const edge = (id: string, from: string, to: string) => {
  const [fromNode, fromPort = "value"] = from.split(":");
  const [toNode, toPort = "value"] = to.split(":");
  return {
    id,
    kind: "signal",
    from: { node: fromNode, port: fromPort },
    to: { node: toNode, port: toPort },
  };
};

export const system = (
  id: string,
  parts: {
    readonly clocks?: ReadonlyArray<unknown>;
    readonly nodes: ReadonlyArray<unknown>;
    readonly edges: ReadonlyArray<unknown>;
    readonly outputs: Readonly<Record<string, string>>;
  },
) => ({
  format: "sw.system",
  schemaVersion: "0.1.0",
  semanticsVersion: "0.1",
  id,
  clocks: parts.clocks ?? [],
  nodes: parts.nodes,
  edges: parts.edges,
  outputs: Object.entries(parts.outputs).map(([output, source]) => {
    const [node, port = "value"] = source.split(":");
    return { id: output, source: { node, port } };
  }),
});

export const runOf = (
  modelRef: string,
  stop: [number, number],
  solver: RunDocument["solver"] | { readonly method: string },
  inputs: ReadonlyArray<unknown> = [],
) => ({
  format: "sw.run",
  schemaVersion: "0.1.0",
  id: "run.test",
  modelRef,
  start: rational(0),
  stop: rational(...stop),
  solver,
  inputs,
  seed: "0",
  probes: [],
});

/** Validate and compile the run at `runFile`; any diagnostic fails the test. */
export const compiledRun = (files: PackFiles, runFile: string) =>
  Effect.gen(function* () {
    const pack = yield* validatePack(files);
    const loaded = pack.documents.get(runFile);
    if (loaded?.format !== "sw.run")
      return assert.fail(`${runFile}: ${pack.diagnostics.map((d) => d.message).join("; ")}`);
    const run = loaded.value;
    const compiled =
      run.modelRef === undefined
        ? yield* compileChart(pack, run.chartRef!)
        : yield* compileSystem(pack, run.modelRef);
    assert.deepStrictEqual(compiled.diagnostics, [], runFile);
    return { pack, run, resolved: compiled.resolved! };
  });
