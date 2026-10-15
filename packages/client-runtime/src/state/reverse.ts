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
    importFile: createEnvironmentRpcCommand(runtime, {
      label: "reverse:import",
      tag: WS_METHODS.reverseImport,
    }),
    link: createEnvironmentRpcCommand(runtime, {
      label: "reverse:link",
      tag: WS_METHODS.reverseLink,
    }),
    strings: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "reverse:strings",
      tag: WS_METHODS.reverseStrings,
      staleTimeMs: 5_000,
    }),
  };
}
