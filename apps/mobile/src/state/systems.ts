import { createSystemsEnvironmentAtoms } from "@t3tools/client-runtime/state/systems";
import { connectionAtomRuntime } from "../connection/runtime";

/** The Systems workbench runs on the connected environment through its authenticated RPC. */
export const systemsEnvironment = createSystemsEnvironmentAtoms(connectionAtomRuntime);
