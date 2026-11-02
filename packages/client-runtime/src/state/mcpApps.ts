import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand, createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createMcpAppEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    callTool: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:mcp-apps:call-tool",
      tag: WS_METHODS.mcpAppsCallTool,
    }),
    toolInfo: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:mcp-apps:tool-info",
      tag: WS_METHODS.mcpAppsToolInfo,
    }),
    /** The tool definition an app reads from its host context. */
    toolInfoQuery: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:mcp-apps:tool-info",
      tag: WS_METHODS.mcpAppsToolInfo,
    }),
    readResource: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:mcp-apps:read-resource",
      tag: WS_METHODS.mcpAppsReadResource,
    }),
    updateModelContext: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:mcp-apps:update-model-context",
      tag: WS_METHODS.mcpAppsUpdateModelContext,
    }),
    /** Directory and git state for a panel's host context; keyed by project and thread. */
    panelContext: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:mcp-apps:panel-context",
      tag: WS_METHODS.mcpAppsPanelContext,
      staleTimeMs: 30_000,
    }),
    /** Runs on each open, since a panel's opening tool may return fresh data. */
    openPanel: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:mcp-apps:open-panel",
      tag: WS_METHODS.mcpAppsOpenPanel,
    }),
  };
}

export function createMcpPluginEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:mcp-plugins:list",
      tag: WS_METHODS.mcpPluginsList,
      staleTimeMs: 1_000,
    }),
    install: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:mcp-plugins:install",
      tag: WS_METHODS.mcpPluginsInstall,
    }),
    uninstall: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:mcp-plugins:uninstall",
      tag: WS_METHODS.mcpPluginsUninstall,
    }),
    setEnabled: createEnvironmentRpcCommand(runtime, {
      label: "environment-command:mcp-plugins:set-enabled",
      tag: WS_METHODS.mcpPluginsSetEnabled,
    }),
  };
}
