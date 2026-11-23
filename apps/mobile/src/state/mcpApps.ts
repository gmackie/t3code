import {
  createMcpAppEnvironmentAtoms,
  createMcpPluginEnvironmentAtoms,
} from "@t3tools/client-runtime/state/mcp-apps";

import { connectionAtomRuntime } from "../connection/runtime";

export const mcpAppEnvironment = createMcpAppEnvironmentAtoms(connectionAtomRuntime);
export const mcpPluginEnvironment = createMcpPluginEnvironmentAtoms(connectionAtomRuntime);
