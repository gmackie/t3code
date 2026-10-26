import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { error, sortDiagnostics, type ModelDiagnostic } from "./diagnostics.ts";
import {
  chartPorts,
  decodeDocument,
  documentFormat,
  isNormalizedPath,
  validateChart,
  validateRun,
  validateSystem,
  validateTrace,
  type DocumentFormat,
  type DocumentOf,
} from "./validate.ts";

/**
 * Cross-file validation of a Systems project or conformance pack: every reference
 * resolves inside the root, library locks match their bytes, and fixtures name
 * real states, transitions and probes. The checks are static; nothing executes.
 */

type Loaded = {
  readonly [F in DocumentFormat]: { readonly format: F; readonly value: DocumentOf<F> };
}[DocumentFormat];

/** A library whose bytes matched its lock entry; only these may define blocks and units. */
export interface VerifiedLibrary {
  readonly name: string;
  readonly version: string;
  readonly file: string;
  readonly sha256: string;
  readonly catalog: DocumentOf<"sw.blockCatalog">;
}

export interface Pack {
  readonly documents: ReadonlyMap<string, Loaded>;
  readonly libraries: ReadonlyArray<VerifiedLibrary>;
  readonly diagnostics: ReadonlyArray<ModelDiagnostic>;
}

export interface PackFiles {
  /** Regular files keyed by `/`-separated path relative to the root. */
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly diagnostics: ReadonlyArray<ModelDiagnostic>;
}

const decoder = new TextDecoder("utf-8", { fatal: true });

/** Read every file below `root`. Anything reached through a symlink is refused, not followed. */
export const readPackFiles = Effect.fn("systemsModel.readPackFiles")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const realRoot = yield* fs.realPath(root);
  const files = new Map<string, Uint8Array>();
  const diagnostics: Array<ModelDiagnostic> = [];
  for (const relative of (yield* fs.readDirectory(realRoot, { recursive: true })).toSorted()) {
    const file = relative.split(path.sep).join("/");
    const full = path.join(realRoot, relative);
    if ((yield* fs.realPath(full)) !== full) {
      diagnostics.push(
        error("E-REF-001", "Paths through symbolic links are not followed", { file }),
      );
      continue;
    }
    if ((yield* fs.stat(full)).type === "File") files.set(file, yield* fs.readFile(full));
  }
  return { files, diagnostics } satisfies PackFiles;
});

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/** Validate a pack. Only library hashing is effectful; everything else is pure. */
export const validatePack = Effect.fn("systemsModel.validatePack")(function* (input: PackFiles) {
  const crypto = yield* Crypto.Crypto;
  const digests = new Map<string, string>();
  for (const [file, bytes] of input.files)
    digests.set(file, hex(yield* crypto.digest("SHA-256", bytes)));
  return checkPack(input, (file) => digests.get(file));
});

const checkPack = (input: PackFiles, sha256: (file: string) => string | undefined): Pack => {
  const files = input.files;
  const documents = new Map<string, Loaded>();
  const diagnostics: Array<ModelDiagnostic> = [...input.diagnostics];
  const report = (
    file: string,
    code: ModelDiagnostic["code"],
    message: string,
    extra: Partial<ModelDiagnostic> = {},
  ) => diagnostics.push(error(code, message, { file, ...extra }));

  for (const [file, bytes] of files) {
    if (!file.endsWith(".json")) continue;
    let input: unknown;
    try {
      input = JSON.parse(decoder.decode(bytes));
    } catch (cause) {
      report(
        file,
        "E-SCHEMA-001",
        `Not valid UTF-8 JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      continue;
    }
    // Draft JSON Schemas ship beside the documents they describe.
    if (typeof input === "object" && input !== null && "$schema" in input) continue;
    const format = documentFormat(input);
    if (format === undefined) {
      report(file, "E-SCHEMA-001", "Unknown or missing document format");
      continue;
    }
    const decoded = decodeDocument(format, input, file);
    diagnostics.push(...decoded.diagnostics);
    if (decoded.value !== undefined)
      documents.set(file, { format, value: decoded.value } as Loaded);
  }

  const resolve = <F extends DocumentFormat>(
    from: string,
    path: string,
    format: F,
    pointer: string,
  ): DocumentOf<F> | undefined => {
    if (!isNormalizedPath(path)) {
      report(from, "E-REF-001", `"${path}" is not a normalized workspace-relative path`, {
        pointer,
      });
      return undefined;
    }
    const target = documents.get(path);
    if (target?.format === format) return target.value as DocumentOf<F>;
    report(
      from,
      "E-REF-001",
      files.has(path) ? `"${path}" is not a valid ${format} document` : `"${path}" does not exist`,
      { pointer },
    );
    return undefined;
  };

  const entries = <F extends DocumentFormat>(format: F) =>
    [...documents].flatMap(([file, loaded]) =>
      loaded.format === format ? [[file, loaded.value as DocumentOf<F>] as const] : [],
    );

  // Only locked libraries, verified byte-for-byte, may define blocks and units.
  const libraries: Array<VerifiedLibrary> = [];
  for (const [file, lock] of entries("sw.lock")) {
    lock.libraries.forEach((library, index) => {
      const pointer = `/libraries/${index}`;
      const catalog = resolve(file, library.file, "sw.blockCatalog", `${pointer}/file`);
      if (catalog === undefined) return;
      if (sha256(library.file) !== library.sha256)
        report(file, "E-REF-001", `Library "${library.name}" does not match its locked sha256`, {
          pointer: `${pointer}/sha256`,
        });
      else libraries.push({ ...library, catalog });
    });
  }
  const catalog = mergeCatalogs(libraries.map((library) => library.catalog));

  for (const [file, project] of entries("sw.project")) {
    resolve(file, project.lockRef, "sw.lock", "/lockRef");
    project.entrypoints.forEach((path, index) =>
      resolve(file, path, "sw.system", `/entrypoints/${index}`),
    );
  }

  const chartOf = new Map<string, DocumentOf<"sw.statechart">>();
  for (const [file, system] of entries("sw.system")) {
    system.nodes.forEach((node, index) => {
      const ref = node.parameters.chart;
      if (typeof ref !== "string") return;
      const chart = resolve(file, ref, "sw.statechart", `/nodes/${index}/parameters/chart`);
      if (chart !== undefined) chartOf.set(ref, chart);
    });
    if (catalog === undefined)
      report(file, "E-REF-001", "No verified library lock provides block types");
    else
      diagnostics.push(
        ...validateSystem(
          system,
          { catalog, chartPorts: (ref) => maybe(chartOf.get(ref), chartPorts) },
          file,
        ),
      );
  }

  for (const [file, chart] of entries("sw.statechart"))
    diagnostics.push(...validateChart(chart, file));

  for (const [file, run] of entries("sw.run")) {
    diagnostics.push(...validateRun(run, file));
    const system =
      run.modelRef === undefined
        ? undefined
        : resolve(file, run.modelRef, "sw.system", "/modelRef");
    const chart =
      run.chartRef === undefined
        ? undefined
        : resolve(file, run.chartRef, "sw.statechart", "/chartRef");
    if (system !== undefined) {
      const outputs = new Set((system.outputs ?? []).map((output) => output.id));
      run.probes.forEach((probe, index) => {
        if (!outputs.has(probe))
          report(file, "E-REF-001", `Probe "${probe}" is not an output of ${system.id}`, {
            pointer: `/probes/${index}`,
          });
      });
    }
    if (chart !== undefined) {
      const events = new Set(chart.interface.events.map((event) => event.id));
      run.inputs.forEach((input, index) => {
        if (!events.has(input.type))
          report(file, "E-REF-001", `Event "${input.type}" is not declared by ${chart.id}`, {
            pointer: `/inputs/${index}/type`,
          });
      });
    }
  }

  for (const [file, trace] of entries("sw.expectedTrace")) {
    diagnostics.push(...validateTrace(trace, file));
    const run = resolve(file, trace.runRef, "sw.run", "/runRef");
    if (run === undefined) continue;
    const probes = new Set(run.probes);
    const chart = runChart(run, documents, chartOf);
    const states = new Set(chart?.states.map((state) => state.id));
    const transitions = new Set(chart?.transitions.map((transition) => transition.id));
    trace.observations.forEach((observation, index) => {
      const at = `/observations/${index}`;
      for (const signal of Object.keys(observation.signals))
        if (!probes.has(signal))
          report(file, "E-REF-001", `Signal "${signal}" is not a probe of ${run.id}`, {
            pointer: `${at}/signals`,
          });
      if (observation.activeState !== undefined && !states.has(observation.activeState))
        report(file, "E-REF-001", `State "${observation.activeState}" is not in the run's chart`, {
          pointer: `${at}/activeState`,
        });
      observation.firedTransitions.forEach((id, transitionIndex) => {
        if (!transitions.has(id))
          report(file, "E-REF-001", `Transition "${id}" is not in the run's chart`, {
            pointer: `${at}/firedTransitions/${transitionIndex}`,
          });
      });
    });
    trace.expectedTransitions.forEach((expected, index) => {
      const at = `/expectedTransitions/${index}`;
      if (!transitions.has(expected.transitionId))
        report(
          file,
          "E-REF-001",
          `Transition "${expected.transitionId}" is not in the run's chart`,
          {
            pointer: `${at}/transitionId`,
          },
        );
      for (const list of ["exit", "enter"] as const)
        expected[list]?.forEach((id, stateIndex) => {
          if (!states.has(id))
            report(file, "E-REF-001", `State "${id}" is not in the run's chart`, {
              pointer: `${at}/${list}/${stateIndex}`,
            });
        });
    });
  }

  for (const [file, layout] of entries("sw.layout")) {
    const system = entries("sw.system").find(
      ([, candidate]) => candidate.id === layout.modelId,
    )?.[1];
    if (system === undefined) {
      report(file, "E-REF-001", `No system has id "${layout.modelId}"`, { pointer: "/modelId" });
      continue;
    }
    const nodes = new Set(system.nodes.map((node) => node.id));
    for (const id of Object.keys(layout.positions))
      if (!nodes.has(id))
        report(file, "E-REF-001", `Node "${id}" is not in ${system.id}`, {
          pointer: `/positions/${id}`,
        });
  }

  for (const [file, manifest] of entries("sw.conformancePack")) {
    manifest.fixtures.forEach((fixture, index) => {
      const at = `/fixtures/${index}`;
      const format = documents.get(fixture.source)?.format;
      if (!isNormalizedPath(fixture.source) || format === undefined)
        report(file, "E-REF-001", `Fixture source "${fixture.source}" does not exist`, {
          pointer: `${at}/source`,
        });
      if ((fixture.expected === undefined) === (fixture.expectedDiagnostic === undefined))
        report(
          file,
          "E-SCHEMA-001",
          "A fixture names exactly one of expected and expectedDiagnostic",
          { pointer: at },
        );
      if (fixture.expected === undefined) return;
      const trace = resolve(file, fixture.expected, "sw.expectedTrace", `${at}/expected`);
      if (
        trace !== undefined &&
        (trace.fixtureId !== fixture.id || trace.runRef !== fixture.source)
      )
        report(
          file,
          "E-REF-001",
          `Expected trace ${fixture.expected} belongs to ${trace.fixtureId}/${trace.runRef}`,
          {
            pointer: `${at}/expected`,
          },
        );
    });
  }

  return { documents, libraries, diagnostics: sortDiagnostics(diagnostics) };
};

/** Files whose diagnostics belong to a document: itself and everything it references. */
export const documentClosure = (pack: Pack, file: string): ReadonlySet<string> => {
  const closure = new Set<string>();
  const visit = (path: string) => {
    const loaded = pack.documents.get(path);
    if (closure.has(path)) return;
    closure.add(path);
    if (loaded === undefined) return;
    switch (loaded.format) {
      case "sw.system":
        for (const node of loaded.value.nodes)
          if (typeof node.parameters.chart === "string") visit(node.parameters.chart);
        return;
      case "sw.run":
        if (loaded.value.modelRef !== undefined) visit(loaded.value.modelRef);
        if (loaded.value.chartRef !== undefined) visit(loaded.value.chartRef);
        return;
      case "sw.expectedTrace":
        return visit(loaded.value.runRef);
    }
  };
  visit(file);
  return closure;
};

export const diagnosticsFor = (pack: Pack, file: string): ReadonlyArray<ModelDiagnostic> => {
  const closure = documentClosure(pack, file);
  return pack.diagnostics.filter(
    (diagnostic) => diagnostic.file !== undefined && closure.has(diagnostic.file),
  );
};

const maybe = <A, B>(value: A | undefined, f: (value: A) => B) =>
  value === undefined ? undefined : f(value);

/** The chart a run drives: its own `chartRef`, or the model's single embedded chart. */
const runChart = (
  run: DocumentOf<"sw.run">,
  documents: ReadonlyMap<string, Loaded>,
  charts: ReadonlyMap<string, DocumentOf<"sw.statechart">>,
) => {
  if (run.chartRef !== undefined)
    return charts.get(run.chartRef) ?? asChart(documents.get(run.chartRef));
  const system = run.modelRef === undefined ? undefined : documents.get(run.modelRef);
  if (system?.format !== "sw.system") return undefined;
  const refs = system.value.nodes.flatMap((node) =>
    typeof node.parameters.chart === "string" ? [node.parameters.chart] : [],
  );
  return refs.length === 1 ? charts.get(refs[0]!) : undefined;
};

const asChart = (loaded: Loaded | undefined) =>
  loaded?.format === "sw.statechart" ? loaded.value : undefined;

const mergeCatalogs = (
  catalogs: ReadonlyArray<DocumentOf<"sw.blockCatalog">>,
): DocumentOf<"sw.blockCatalog"> | undefined => {
  const [first, ...rest] = catalogs;
  if (first === undefined) return undefined;
  const units = { ...first.units };
  const blockTypes = [...first.blockTypes];
  for (const next of rest) {
    Object.assign(units, next.units);
    blockTypes.push(...next.blockTypes);
  }
  return { ...first, units, blockTypes };
};
