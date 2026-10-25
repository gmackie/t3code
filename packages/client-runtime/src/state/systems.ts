import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { WS_METHODS } from "@t3tools/contracts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "./runtime.ts";

/** Systems Workbench operations; runs execute on the connected environment, never the client. */
export function createSystemsEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    validate: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "systems:validate",
      tag: WS_METHODS.systemsValidate,
      staleTimeMs: 2_000,
    }),
    compile: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "systems:compile",
      tag: WS_METHODS.systemsCompile,
      staleTimeMs: 2_000,
    }),
    capabilities: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "systems:capabilities",
      tag: WS_METHODS.systemsTargetsCapabilities,
      staleTimeMs: 60_000,
    }),
    run: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "systems:run",
      tag: WS_METHODS.systemsRunsGet,
      staleTimeMs: 1_000,
    }),
    runs: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "systems:runs",
      tag: WS_METHODS.systemsRunsList,
      staleTimeMs: 1_000,
    }),
    runsLive: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "systems:runs:live",
      tag: WS_METHODS.systemsRunsSubscribe,
    }),
    events: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "systems:events",
      tag: WS_METHODS.systemsRunsEvents,
      staleTimeMs: 1_000,
    }),
    signals: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "systems:signals",
      tag: WS_METHODS.systemsRunsSignals,
      staleTimeMs: 1_000,
    }),
    compare: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "systems:compare",
      tag: WS_METHODS.systemsRunsCompare,
      staleTimeMs: 5_000,
    }),
    semanticDiff: createEnvironmentRpcCommand(runtime, {
      label: "systems:semantic-diff",
      tag: WS_METHODS.systemsSemanticDiff,
    }),
    createRun: createEnvironmentRpcCommand(runtime, {
      label: "systems:run-create",
      tag: WS_METHODS.systemsRunsCreate,
    }),
    cancelRun: createEnvironmentRpcCommand(runtime, {
      label: "systems:run-cancel",
      tag: WS_METHODS.systemsRunsCancel,
    }),
    conformance: createEnvironmentRpcCommand(runtime, {
      label: "systems:conformance",
      tag: WS_METHODS.systemsConformanceExecute,
    }),
  };
}
