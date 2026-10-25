import { createSystemsEnvironmentAtoms } from "@t3tools/client-runtime/state/systems";
import { connectionAtomRuntime } from "../connection/runtime";

/** The Systems workspace connects through T3's authenticated environment RPC. */
export const systemsEnvironment = createSystemsEnvironmentAtoms(connectionAtomRuntime);
