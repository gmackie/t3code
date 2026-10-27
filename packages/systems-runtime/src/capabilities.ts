import type { ResolvedChart, ResolvedSystem } from "@t3tools/systems-compiler/compile";
import { error, type ModelDiagnostic } from "@t3tools/systems-model/diagnostics";
import type { RunDocument } from "@t3tools/systems-model/documents";

import { SUPPORTED_BLOCKS } from "./blocks.ts";

/**
 * RFC-001 §13.1 capability handshake of this reference runner, and the check that a
 * run's requirements fit it. A missing capability is `E-TARGET-001` before anything
 * model-specific executes; the runner never silently degrades.
 */

export const RUNNER_PROTOCOL = "sw-runner/0.1";
export const RUNTIME_VERSION = "systems-runtime@0.1.0";

export type SolverMethod = RunDocument["solver"]["method"];

export interface RunnerCapabilities {
  readonly protocol: typeof RUNNER_PROTOCOL;
  readonly runtimeVersion: string;
  readonly semanticsVersions: ReadonlyArray<string>;
  readonly capabilities: {
    readonly statechartExclusive: boolean;
    readonly continuousODE: boolean;
    readonly periodicRationalClocks: boolean;
    readonly continuousZeroCrossings: boolean;
    readonly parallelStateRegions: boolean;
    readonly fmiModelExchange: boolean;
    readonly checkpointRestore: boolean;
    readonly untrustedNativeCode: boolean;
  };
  readonly solvers: ReadonlyArray<string>;
  /** Versioned block type ids this runner can execute. */
  readonly blocks: ReadonlyArray<string>;
  /** Same validated model and inputs give the same trace on this runner. */
  readonly deterministicProfile: "reference-float64";
}

/** Solvers this build implements, by pinned identity. */
export const SOLVERS: ReadonlyArray<string> = [];

export const capabilities = (): RunnerCapabilities => ({
  protocol: RUNNER_PROTOCOL,
  runtimeVersion: RUNTIME_VERSION,
  semanticsVersions: ["0.1"],
  capabilities: {
    statechartExclusive: true,
    continuousODE: SOLVERS.length > 0,
    periodicRationalClocks: true,
    continuousZeroCrossings: false,
    parallelStateRegions: false,
    fmiModelExchange: false,
    checkpointRestore: false,
    untrustedNativeCode: false,
  },
  solvers: SOLVERS,
  blocks: SUPPORTED_BLOCKS,
  deterministicProfile: "reference-float64",
});

export type Capability = keyof RunnerCapabilities["capabilities"];

/** The normalized requirement set of one run against one resolved plan (RFC-001 §12). */
export interface RunRequirements {
  readonly semanticsVersion: string;
  readonly solver: SolverMethod;
  readonly capabilities: ReadonlyArray<Capability>;
  readonly blocks: ReadonlyArray<{ readonly node: string; readonly type: string }>;
}

export const isResolvedSystem = (
  resolved: ResolvedSystem | ResolvedChart,
): resolved is ResolvedSystem => "systemId" in resolved;

export const requirementsOf = (
  resolved: ResolvedSystem | ResolvedChart,
  run: RunDocument,
): RunRequirements => {
  if (!isResolvedSystem(resolved))
    return {
      semanticsVersion: resolved.chart.semanticsVersion,
      solver: run.solver.method,
      capabilities: ["statechartExclusive"],
      blocks: [],
    };
  const nodes = Object.values(resolved.nodes);
  const needs = new Set<Capability>();
  if (resolved.clocks.length > 0) needs.add("periodicRationalClocks");
  if (nodes.some((node) => node.type === "std.statechart@1")) needs.add("statechartExclusive");
  if (nodes.some((node) => node.type === "std.integrator@1")) needs.add("continuousODE");
  return {
    semanticsVersion: "0.1",
    solver: run.solver.method,
    capabilities: [...needs].toSorted(),
    blocks: nodes.map((node) => ({ node: node.id, type: node.type })),
  };
};

/** `E-TARGET-001` for every requirement the runner lacks; empty when the run may start. */
export const checkRequirements = (
  requirements: RunRequirements,
  runner: RunnerCapabilities = capabilities(),
): ReadonlyArray<ModelDiagnostic> => {
  const diagnostics: Array<ModelDiagnostic> = [];
  if (!runner.semanticsVersions.includes(requirements.semanticsVersion))
    diagnostics.push(
      error(
        "E-TARGET-001",
        `Semantics version ${requirements.semanticsVersion} is not supported by ${runner.protocol}`,
      ),
    );
  for (const capability of requirements.capabilities)
    if (!runner.capabilities[capability])
      diagnostics.push(
        error("E-TARGET-001", `The runner does not support ${capability}`, {
          fix: {
            kind: "choose-target",
            explanation: `Run on a target whose capabilities include ${capability}`,
          },
        }),
      );
  if (requirements.solver !== "none" && !runner.solvers.includes(requirements.solver))
    diagnostics.push(
      error("E-TARGET-001", `Solver method ${requirements.solver} is not available`, {
        fix: {
          kind: "choose-solver",
          explanation: `Available solvers: ${runner.solvers.join(", ") || "none"}`,
        },
      }),
    );
  if (requirements.capabilities.includes("continuousODE") && requirements.solver === "none")
    diagnostics.push(
      error("E-TARGET-001", "The model has continuous states but the run names no solver", {
        fix: { kind: "choose-solver", explanation: "Set solver.method to an ODE solver" },
      }),
    );
  for (const { node, type } of requirements.blocks)
    if (!runner.blocks.includes(type))
      diagnostics.push(
        error("E-TARGET-001", `Block type ${type} has no runtime implementation`, {
          elementId: node,
        }),
      );
  return diagnostics;
};
