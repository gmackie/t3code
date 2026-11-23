import type { McpPluginEntry, McpPluginPanel } from "@t3tools/contracts";

export interface PluginPanelChoice {
  readonly key: string;
  readonly pluginId: string;
  readonly pluginName: string;
  readonly panelId: string;
  readonly title: string;
  readonly scope: McpPluginPanel["scope"];
}

/** Panels of enabled plugins; thread panels only when a thread is open to follow. */
export function pluginPanelChoices(
  entries: ReadonlyArray<McpPluginEntry>,
  options: { readonly threadOpen: boolean },
): ReadonlyArray<PluginPanelChoice> {
  return entries.flatMap((entry) =>
    entry.enabled
      ? entry.manifest.contributes.panels
          .filter((panel) => options.threadOpen || panel.scope === "project")
          .map((panel) => ({
            key: `${entry.manifest.id}/${panel.id}`,
            pluginId: entry.manifest.id,
            pluginName: entry.manifest.displayName,
            panelId: panel.id,
            title: panel.title,
            scope: panel.scope,
          }))
      : [],
  );
}

/** Route params for the PluginPanel screen; only thread panels carry the thread. */
export function pluginPanelRouteParams(
  choice: PluginPanelChoice,
  context: {
    readonly environmentId: string;
    readonly projectId: string;
    readonly threadId?: string;
  },
) {
  return {
    environmentId: context.environmentId,
    pluginId: choice.pluginId,
    panelId: choice.panelId,
    projectId: context.projectId,
    ...(choice.scope === "thread" && context.threadId !== undefined
      ? { threadId: context.threadId }
      : {}),
  };
}
