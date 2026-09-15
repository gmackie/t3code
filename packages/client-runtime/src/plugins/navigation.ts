import type { PluginNavigationContribution } from "@t3tools/contracts";
import type { PluginRegistryEntry } from "@t3tools/contracts";
import type { PluginRegistry } from "./registry.ts";

export type PluginNavigationItem = PluginNavigationContribution & {
  pluginId: string;
  displayName: string;
};
export type PluginQuickNavItem = {
  pluginId: string;
  displayName: string;
  id: string;
  title: string;
  kind: "navigation" | "panel" | "workflow";
  href: string;
  surface?: "settings" | "project" | "thread.sidePanel" | "thread.main";
};

export function buildPluginNavigationUrl(
  pluginId: string,
  path: string,
  context: { projectId?: string; threadId?: string } = {},
): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const query = new URLSearchParams();
  if (context.projectId) query.set("projectId", context.projectId);
  if (context.threadId) query.set("threadId", context.threadId);
  const suffix = query.toString();
  return `/plugins/${encodeURIComponent(pluginId)}${normalizedPath}${suffix ? `?${suffix}` : ""}`;
}

export function listPluginNavigation(registry: PluginRegistry): readonly PluginNavigationItem[] {
  return registry
    .list()
    .filter((plugin) => plugin.state === "enabled")
    .flatMap((plugin) =>
      (plugin.manifest.contributes.navigation ?? []).map((item) => ({
        pluginId: plugin.manifest.id,
        displayName: plugin.manifest.displayName,
        ...item,
      })),
    );
}

export function buildPluginPanelUrl(
  pluginId: string,
  panelId: string,
  context: { projectId?: string; threadId?: string } = {},
): string {
  const query = new URLSearchParams({ panel: panelId });
  if (context.projectId) query.set("projectId", context.projectId);
  if (context.threadId) query.set("threadId", context.threadId);
  return `/plugins/${encodeURIComponent(pluginId)}?${query.toString()}`;
}

export function buildPluginWorkflowUrl(
  pluginId: string,
  workflowId: string,
  context: { projectId?: string; threadId?: string } = {},
): string {
  const query = new URLSearchParams({ workflow: workflowId });
  if (context.projectId) query.set("projectId", context.projectId);
  if (context.threadId) query.set("threadId", context.threadId);
  return `/plugins/${encodeURIComponent(pluginId)}?${query.toString()}`;
}

export function listPluginQuickNav(
  registry: PluginRegistry,
  context: { projectId?: string; threadId?: string } = {},
): readonly PluginQuickNavItem[] {
  return registry
    .list()
    .filter((plugin) => plugin.state === "enabled")
    .flatMap((plugin) => [
      ...(plugin.manifest.contributes.navigation ?? []).map((item) => ({
        pluginId: plugin.manifest.id,
        displayName: plugin.manifest.displayName,
        id: item.id,
        title: item.title,
        kind: "navigation" as const,
        href: buildPluginNavigationUrl(plugin.manifest.id, item.path, context),
      })),
      ...(plugin.manifest.contributes.panels ?? []).map((item) => ({
        pluginId: plugin.manifest.id,
        displayName: plugin.manifest.displayName,
        id: item.id,
        title: item.title,
        kind: "panel" as const,
        href: buildPluginPanelUrl(plugin.manifest.id, item.id, context),
        surface: item.surface,
      })),
      ...(plugin.manifest.contributes.workflows ?? []).map((item) => ({
        pluginId: plugin.manifest.id,
        displayName: plugin.manifest.displayName,
        id: item.id,
        title: item.title,
        kind: "workflow" as const,
        href: buildPluginWorkflowUrl(plugin.manifest.id, item.id, context),
        surface: item.surface,
      })),
    ]);
}

export function listPluginQuickNavFromEntries(
  entries: readonly PluginRegistryEntry[],
  context: { projectId?: string; threadId?: string } = {},
): readonly PluginQuickNavItem[] {
  return entries
    .filter((plugin) => plugin.health.state !== "stopped" && plugin.health.state !== "crashed")
    .flatMap((plugin) => [
      ...plugin.navigation.map((item) => ({
        pluginId: plugin.pluginId,
        displayName: plugin.displayName,
        id: item.id,
        title: item.title,
        kind: "navigation" as const,
        href: buildPluginNavigationUrl(plugin.pluginId, item.path, context),
      })),
      ...plugin.panels.map((item) => ({
        pluginId: plugin.pluginId,
        displayName: plugin.displayName,
        id: item.id,
        title: item.title,
        kind: "panel" as const,
        href: buildPluginPanelUrl(plugin.pluginId, item.id, context),
        surface: item.surface,
      })),
      ...plugin.workflows.map((item) => ({
        pluginId: plugin.pluginId,
        displayName: plugin.displayName,
        id: item.id,
        title: item.title,
        kind: "workflow" as const,
        href: buildPluginWorkflowUrl(plugin.pluginId, item.id, context),
        surface: item.surface,
      })),
    ]);
}
