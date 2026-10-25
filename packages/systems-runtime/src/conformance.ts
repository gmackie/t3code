import * as Effect from "effect/Effect";
import { compileChart, compileSystem } from "@t3tools/systems-compiler/compile";
import {
  hasErrors,
  sortDiagnostics,
  type DiagnosticCode,
  type ModelDiagnostic,
} from "@t3tools/systems-model/diagnostics";
import type { ConformancePackDocument, RunDocument } from "@t3tools/systems-model/documents";
import type { Pack } from "@t3tools/systems-model/pack";

import { compareToExpected, type Mismatch } from "./compare.ts";
import { simulate, type SimulationOptions } from "./simulate.ts";

/**
 * `systems.conformance.execute` (RFC-001 §13.2, §14): compile, simulate and compare every
 * fixture of every conformance manifest in a pack. A diagnostic fixture passes when its
 * code arises from compilation or from the run.
 */

type Fixture = ConformancePackDocument["fixtures"][number];

export interface FixtureReport {
  readonly id: string;
  readonly source: string;
  readonly status: "pass" | "fail";
  /** One human-readable line per finding. */
  readonly details: ReadonlyArray<string>;
  readonly mismatches: ReadonlyArray<Mismatch>;
  readonly diagnostics: ReadonlyArray<ModelDiagnostic>;
}

const describe = (diagnostic: ModelDiagnostic) =>
  `${diagnostic.code}${diagnostic.elementId === undefined ? "" : ` at ${diagnostic.elementId}`}: ${diagnostic.message}`;

const report = (
  fixture: Fixture,
  pass: boolean,
  details: ReadonlyArray<string>,
  diagnostics: ReadonlyArray<ModelDiagnostic> = [],
  mismatches: ReadonlyArray<Mismatch> = [],
): FixtureReport => ({
  id: fixture.id,
  source: fixture.source,
  status: pass ? "pass" : "fail",
  details,
  mismatches,
  diagnostics,
});

/** A diagnostic fixture: the expected code must appear; any other outcome fails. */
const expectCode = (
  fixture: Fixture,
  code: DiagnosticCode,
  diagnostics: ReadonlyArray<ModelDiagnostic>,
  stage: string,
) => {
  const found = diagnostics.filter((diagnostic) => diagnostic.code === code);
  return found.length > 0
    ? report(fixture, true, [`${stage}: ${found.map(describe).join("; ")}`], diagnostics)
    : report(
        fixture,
        false,
        [
          `expected ${code} from compile or run; got ${diagnostics.map(describe).join("; ") || "no diagnostics"}`,
        ],
        diagnostics,
      );
};

const compileRun = Effect.fn("systemsRuntime.compileRun")(function* (pack: Pack, run: RunDocument) {
  if (run.modelRef !== undefined) return yield* compileSystem(pack, run.modelRef);
  return yield* compileChart(pack, run.chartRef ?? "");
});

const executeFixture = Effect.fn("systemsRuntime.executeFixture")(function* (
  pack: Pack,
  fixture: Fixture,
  options: Omit<SimulationOptions, "runId">,
) {
  const source = pack.documents.get(fixture.source);
  if (source?.format === "sw.system") {
    const compiled = yield* compileSystem(pack, fixture.source);
    if (fixture.expectedDiagnostic !== undefined)
      return expectCode(fixture, fixture.expectedDiagnostic, compiled.diagnostics, "compile");
    return report(fixture, false, ["a system fixture has no run to compare against a trace"]);
  }
  if (source?.format !== "sw.run")
    return report(fixture, false, [`${fixture.source} is not a run or system document`]);

  const run = source.value;
  const compiled = yield* compileRun(pack, run);
  const diagnostics = sortDiagnostics([
    ...pack.diagnostics.filter((diagnostic) => diagnostic.file === fixture.source),
    ...compiled.diagnostics,
  ]);
  if (hasErrors(diagnostics) || compiled.resolved === undefined)
    return fixture.expectedDiagnostic === undefined
      ? report(fixture, false, diagnostics.map(describe), diagnostics)
      : expectCode(fixture, fixture.expectedDiagnostic, diagnostics, "compile");

  const outcome = simulate(compiled.resolved, run, { ...options, runId: fixture.id });
  if (fixture.expectedDiagnostic !== undefined)
    return expectCode(fixture, fixture.expectedDiagnostic, outcome.diagnostics, "run");
  const expected =
    fixture.expected === undefined ? undefined : pack.documents.get(fixture.expected);
  if (expected?.format !== "sw.expectedTrace")
    return report(fixture, false, [`expected trace ${fixture.expected} did not load`]);
  const mismatches = compareToExpected(outcome, expected.value);
  return mismatches.length === 0
    ? report(
        fixture,
        true,
        [
          `${expected.value.observations.length} observations and ${expected.value.expectedTransitions.length} transitions matched`,
        ],
        outcome.diagnostics,
      )
    : report(
        fixture,
        false,
        mismatches.map((mismatch) => mismatch.message),
        outcome.diagnostics,
        mismatches,
      );
});

/** Run every fixture of every `sw.conformancePack` in the pack, in manifest path order. */
export const executeConformance = Effect.fn("systemsRuntime.executeConformance")(function* (
  pack: Pack,
  options: Omit<SimulationOptions, "runId"> = {},
) {
  const reports: Array<FixtureReport> = [];
  for (const [, loaded] of [...pack.documents].toSorted(([a], [b]) => (a < b ? -1 : 1)))
    if (loaded.format === "sw.conformancePack")
      for (const fixture of loaded.value.fixtures)
        reports.push(yield* executeFixture(pack, fixture, options));
  return reports;
});
