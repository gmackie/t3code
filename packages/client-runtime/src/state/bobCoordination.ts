import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";
export function createBobCoordinationAtoms<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, ER>,
) {
  return {
    connection: createEnvironmentRpcQueryAtomFamily(runtime, {
      tag: WS_METHODS.serverBobConnection,
      label: "bob:connection",
      staleTimeMs: 1000,
    }),
    call: createEnvironmentRpcCommand(runtime, {
      tag: WS_METHODS.serverBobCoordination,
      label: "bob:operation",
      concurrency: { mode: "parallel" },
    }),
  };
}
