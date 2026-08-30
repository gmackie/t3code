import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";
import { WS_METHODS } from "@t3tools/contracts";

import { connectionAtomRuntime } from "../connection/runtime";

export const projectSessionImportEnvironment = {
  scan: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "project and session import scan",
    tag: WS_METHODS.projectSessionImportsScan,
  }),
};
