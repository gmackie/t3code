import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { WS_METHODS } from "@t3tools/contracts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

/** All operations run on the connected environment, not on the browser device. */
export function createReverseEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "reverse:list",
      tag: WS_METHODS.reverseList,
      staleTimeMs: 1_000,
    }),
    toolchain: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "reverse:toolchain",
      tag: WS_METHODS.reverseToolchain,
      staleTimeMs: 30_000,
    }),
    importFile: createEnvironmentRpcCommand(runtime, {
      label: "reverse:import",
      tag: WS_METHODS.reverseImport,
    }),
    link: createEnvironmentRpcCommand(runtime, {
      label: "reverse:link",
      tag: WS_METHODS.reverseLink,
    }),
    publish: createEnvironmentRpcCommand(runtime, {
      label: "reverse:publish",
      tag: WS_METHODS.reversePublish,
    }),
    importExtracted: createEnvironmentRpcCommand(runtime, {
      label: "reverse:import-extracted",
      tag: WS_METHODS.reverseImportExtracted,
    }),
    createFinding: createEnvironmentRpcCommand(runtime, {
      label: "reverse:finding-create",
      tag: WS_METHODS.reverseFindingCreate,
    }),
    updateFinding: createEnvironmentRpcCommand(runtime, {
      label: "reverse:finding-update",
      tag: WS_METHODS.reverseFindingUpdate,
    }),
    remove: createEnvironmentRpcCommand(runtime, {
      label: "reverse:delete",
      tag: WS_METHODS.reverseDelete,
    }),
    analyze: createEnvironmentRpcCommand(runtime, {
      label: "reverse:analyze",
      tag: WS_METHODS.reverseAnalyze,
    }),
    emulate: createEnvironmentRpcCommand(runtime, {
      label: "reverse:emulate",
      tag: WS_METHODS.reverseEmulate,
    }),
    strings: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "reverse:strings",
      tag: WS_METHODS.reverseStrings,
      staleTimeMs: 5_000,
    }),
  };
}
