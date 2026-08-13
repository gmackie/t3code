import type { PluginCapabilityRequest, PluginManifest } from "@t3tools/contracts";

export type PluginSource =
  | { kind: "git"; url: string; commit: string }
  | { kind: "catalog"; id: string };

export type InstalledPlugin = {
  manifest: PluginManifest;
  source: PluginSource;
  grants: readonly PluginCapabilityRequest[];
  state: "installed" | "enabled";
};

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const sameCapability = (left: PluginCapabilityRequest, right: PluginCapabilityRequest) =>
  stable(left) === stable(right);

export class PluginRegistry {
  #plugins = new Map<string, InstalledPlugin>();

  install(input: { manifest: PluginManifest; source: PluginSource }): InstalledPlugin {
    if (this.#plugins.has(input.manifest.id)) {
      throw new Error(`plugin already installed: ${input.manifest.id}`);
    }
    const record: InstalledPlugin = { ...input, grants: [], state: "installed" };
    this.#plugins.set(input.manifest.id, record);
    return record;
  }

  get(pluginId: string): InstalledPlugin {
    const plugin = this.#plugins.get(pluginId);
    if (!plugin) throw new Error(`plugin not installed: ${pluginId}`);
    return plugin;
  }

  list(): readonly InstalledPlugin[] {
    return [...this.#plugins.values()];
  }

  grant(pluginId: string, capability: PluginCapabilityRequest): void {
    const plugin = this.get(pluginId);
    if (!plugin.manifest.capabilities.some((requested) => sameCapability(requested, capability))) {
      throw new Error(`capability was not requested by plugin: ${capability.kind}`);
    }
    if (plugin.grants.some((granted) => sameCapability(granted, capability))) return;
    this.#plugins.set(pluginId, { ...plugin, grants: [...plugin.grants, capability] });
  }

  revoke(pluginId: string, capability: PluginCapabilityRequest): void {
    const plugin = this.get(pluginId);
    this.#plugins.set(pluginId, {
      ...plugin,
      grants: plugin.grants.filter((granted) => !sameCapability(granted, capability)),
      state: "installed",
    });
  }

  enable(pluginId: string): void {
    const plugin = this.get(pluginId);
    const missing = plugin.manifest.capabilities.filter(
      (requested) => !plugin.grants.some((granted) => sameCapability(granted, requested)),
    );
    if (missing.length > 0) throw new Error(`missing capability grant for ${missing[0]?.kind}`);
    this.#plugins.set(pluginId, { ...plugin, state: "enabled" });
  }

  disable(pluginId: string): void {
    const plugin = this.get(pluginId);
    this.#plugins.set(pluginId, { ...plugin, state: "installed" });
  }
}
