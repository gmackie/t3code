import type { PluginHealth, PluginManifest, PluginPackageSource } from "@t3tools/contracts";

import { CapabilityAuthorizer } from "./capabilityAuthorizer.ts";
import { PluginStateStore } from "./stateStore.ts";

type PluginRecord = {
  manifest: PluginManifest;
  source: PluginPackageSource;
  grants: readonly PluginManifest["capabilities"][number][];
  state: PluginHealth["state"];
  directory?: string;
};

export class PluginLifecycle {
  readonly #authorizer = new CapabilityAuthorizer();
  readonly #plugins = new Map<string, PluginRecord>();
  readonly #store: PluginStateStore | undefined;

  constructor(store?: PluginStateStore) {
    this.#store = store;
    for (const persisted of store?.load() ?? []) {
      this.#plugins.set(persisted.manifest.id, {
        manifest: persisted.manifest,
        source: persisted.source,
        grants: persisted.grants,
        state: "stopped",
        ...(persisted.directory ? { directory: persisted.directory } : {}),
      });
      for (const grant of persisted.grants) this.#authorizer.grant(persisted.manifest.id, grant);
    }
  }

  install(input: {
    manifest: PluginManifest;
    source: PluginPackageSource;
    directory?: string;
  }): void {
    if (this.#plugins.has(input.manifest.id)) {
      throw new Error(`plugin already installed: ${input.manifest.id}`);
    }
    this.#plugins.set(input.manifest.id, {
      manifest: input.manifest,
      source: input.source,
      ...(input.directory ? { directory: input.directory } : {}),
      grants: [],
      state: "stopped",
    });
    this.#persist();
  }

  snapshot(): readonly PluginRecord[] {
    return [...this.#plugins.values()].map((plugin) => ({ ...plugin }));
  }

  has(pluginId: string): boolean {
    return this.#plugins.has(pluginId);
  }

  grant(pluginId: string, capability: PluginManifest["capabilities"][number]): void {
    const plugin = this.#get(pluginId);
    if (
      !plugin.manifest.capabilities.some(
        (requested) => JSON.stringify(requested) === JSON.stringify(capability),
      )
    ) {
      throw new Error(`capability was not requested by plugin: ${capability.kind}`);
    }
    if (!plugin.grants.some((grant) => JSON.stringify(grant) === JSON.stringify(capability))) {
      this.#authorizer.grant(pluginId, capability);
      this.#plugins.set(pluginId, { ...plugin, grants: [...plugin.grants, capability] });
    }
    this.#persist();
  }

  enable(pluginId: string): void {
    const plugin = this.#get(pluginId);
    const missing = plugin.manifest.capabilities.find(
      (capability) => !this.#authorizer.hasGrant(pluginId, capability),
    );
    if (missing) throw new Error(`missing capability grant for ${missing.kind}`);
    this.#plugins.set(pluginId, { ...plugin, state: "healthy" });
    this.#persist();
  }

  revoke(pluginId: string, capability?: PluginManifest["capabilities"][number]): void {
    this.#authorizer.revoke(pluginId, capability);
    const plugin = this.#get(pluginId);
    const grants =
      capability === undefined
        ? []
        : plugin.grants.filter((grant) => JSON.stringify(grant) !== JSON.stringify(capability));
    this.#plugins.set(pluginId, { ...plugin, grants, state: "stopped" });
    this.#persist();
  }

  disable(pluginId: string): void {
    const plugin = this.#get(pluginId);
    this.#plugins.set(pluginId, { ...plugin, state: "stopped" });
    this.#persist();
  }

  health(pluginId: string): PluginHealth {
    const plugin = this.#get(pluginId);
    return { pluginId, state: plugin.state };
  }

  #get(pluginId: string): PluginRecord {
    const plugin = this.#plugins.get(pluginId);
    if (!plugin) throw new Error(`plugin not installed: ${pluginId}`);
    return plugin;
  }

  #persist(): void {
    this.#store?.save(
      [...this.#plugins.values()].map(({ manifest, source, grants, directory }) => ({
        manifest,
        source,
        grants,
        ...(directory ? { directory } : {}),
      })),
    );
  }
}
