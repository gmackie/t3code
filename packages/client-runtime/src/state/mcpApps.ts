import {
  EnvironmentId,
  WS_METHODS,
  type McpPluginEntry,
  type McpPluginId,
  type McpPluginPanelId,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";

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

export interface IssuesPluginTab {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly pluginId: McpPluginId;
  readonly panelId: McpPluginPanelId;
  readonly title: string;
  readonly pluginName: string;
}

/** The `issuesTab` panels of enabled plugins, in environment then manifest order. */
function issuesPluginTabs(
  lists: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly entries: ReadonlyArray<McpPluginEntry>;
  }>,
): ReadonlyArray<IssuesPluginTab> {
  return lists.flatMap(({ environmentId, entries }) =>
    entries.flatMap((entry) =>
      entry.enabled
        ? entry.manifest.contributes.panels
            .filter((panel) => panel.issuesTab === true)
            .map((panel) => ({
              key: issuesPluginTabKey(environmentId, entry.manifest.id, panel.id),
              environmentId,
              pluginId: entry.manifest.id,
              panelId: panel.id,
              title: panel.title,
              pluginName: entry.manifest.displayName,
            }))
        : [],
    ),
  );
}

/** Plugin and panel ids cannot hold a space, so the key splits back unambiguously. */
const issuesPluginTabKey = (environmentId: string, pluginId: string, panelId: string): string =>
  `${environmentId} ${pluginId} ${panelId}`;

export function createMcpPluginEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const list = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:mcp-plugins:list",
    tag: WS_METHODS.mcpPluginsList,
    staleTimeMs: 1_000,
  });
  return {
    list,
    /** Keyed by environment ids joined with spaces; an environment still loading adds none. */
    issuesTabs: Atom.family((environmentKey: string) =>
      Atom.make((get) =>
        issuesPluginTabs(
          environmentKey
            .split(" ")
            .filter((id) => id.length > 0)
            .map((id) => {
              const environmentId = EnvironmentId.make(id);
              return {
                environmentId,
                entries: AsyncResult.getOrElse(get(list({ environmentId, input: {} })), () => []),
              };
            }),
        ),
      ).pipe(Atom.withLabel(`environment-data:mcp-plugins:issues-tabs:${environmentKey}`)),
    ),
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
