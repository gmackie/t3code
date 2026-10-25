import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { error } from "./diagnostics.ts";
import { readReferencedFiles, validatePack, type ParseJson } from "./pack.ts";

const FIXTURES = new URL("../fixtures/conformance-v0.1/", import.meta.url);
const decoder = new TextDecoder();

const parse: ParseJson = (bytes, file) => {
  try {
    return { value: JSON.parse(decoder.decode(bytes)), diagnostics: [] };
  } catch {
    return { diagnostics: [error("E-SCHEMA-001", "Not JSON", { file })] };
  }
};

/** The conformance pack copied into a temp dir that also holds a repository's clutter. */
const project = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped();
  yield* fs.copy(yield* path.fromFileUrl(FIXTURES), root);
  yield* fs.makeDirectory(path.join(root, "node_modules", "dep"), { recursive: true });
  yield* fs.writeFileString(path.join(root, "node_modules", "dep", "x.json"), "{");
  return { fs, path, root };
});

it.layer(NodeServices.layer)("readReferencedFiles", (it) => {
  it.effect("reads the project closure and named experiments, nothing else", () =>
    Effect.gen(function* () {
      const { root } = yield* project;
      const read = yield* readReferencedFiles(
        root,
        ["systems.project.json", "expected/pump-nominal.trace.json"],
        parse,
      );
      assert.deepStrictEqual([...read.files.keys()].toSorted(), [
        "expected/pump-nominal.trace.json",
        "experiments/pump-nominal.run.json",
        "libraries/std.blocks.json",
        "models/cross-clock.system.json",
        "models/exponential-decay.system.json",
        "models/pump.system.json",
        "statecharts/pump.chart.json",
        "systems.lock.json",
        "systems.project.json",
      ]);
      assert.deepStrictEqual(read.diagnostics, []);
      const pack = yield* validatePack(read);
      assert.deepStrictEqual(pack.diagnostics, []);
      assert.strictEqual(pack.libraries.length, 1);
    }).pipe(Effect.scoped),
  );

  it.effect("refuses symlinks, traversal and files the parser rejects", () =>
    Effect.gen(function* () {
      const { fs, path, root } = yield* project;
      const outside = yield* fs.makeTempDirectoryScoped();
      yield* fs.writeFileString(path.join(outside, "secret.json"), "{}");
      yield* fs.symlink(path.join(outside, "secret.json"), path.join(root, "linked.json"));
      yield* fs.writeFileString(path.join(root, "broken.json"), "{");
      const read = yield* readReferencedFiles(
        root,
        ["linked.json", "../secret.json", "broken.json", "missing.json"],
        parse,
      );
      assert.deepStrictEqual([...read.files.keys()], []);
      assert.deepStrictEqual(
        read.diagnostics.map((d) => [d.code, d.file]),
        [
          ["E-REF-001", "linked.json"],
          ["E-REF-001", "../secret.json"],
          ["E-SCHEMA-001", "broken.json"],
        ],
      );
    }).pipe(Effect.scoped),
  );
});
