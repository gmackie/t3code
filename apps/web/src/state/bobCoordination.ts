import { createBobCoordinationAtoms } from "@t3tools/client-runtime/state/bobCoordination";
import { connectionAtomRuntime } from "../connection/runtime";
export const bobCoordination = createBobCoordinationAtoms(connectionAtomRuntime);
