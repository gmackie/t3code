import { WS_METHODS } from "@t3tools/contracts";
import { createEnvironmentRpcCommand } from "@t3tools/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../connection/runtime";

export const externalThreadImportEnvironment = {
  discover: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "external thread import discovery",
    tag: WS_METHODS.externalThreadsDiscover,
  }),
  importSelected: createEnvironmentRpcCommand(connectionAtomRuntime, {
    label: "external thread import",
    tag: WS_METHODS.externalThreadsImport,
  }),
};
