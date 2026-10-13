import { createReverseEnvironmentAtoms } from "@t3tools/client-runtime/state/reverse";
import { connectionAtomRuntime } from "../connection/runtime";

/** The Reverse workspace connects through T3's authenticated environment RPC. */
export const reverseEnvironment = createReverseEnvironmentAtoms(connectionAtomRuntime);
