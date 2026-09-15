// @effect-diagnostics nodeBuiltinImport:off - plugin settings persistence is a server-side boundary.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import {
  isPluginSettingSecret,
  type PluginSettingContribution,
  type PluginSettingValueMap,
  validatePluginSettings,
} from "@t3tools/contracts";

type StoredPluginSettings = {
  server: PluginSettingValueMap;
  projects: Record<string, PluginSettingValueMap>;
};

type StoredSettings = Record<string, StoredPluginSettings>;

export class PluginSettingsStore {
  readonly #path: string;

  constructor(path: string) {
    this.#path = path;
  }

  get(
    pluginId: string,
    projectId: string | undefined,
    contributions: readonly PluginSettingContribution[],
  ): PluginSettingValueMap {
    const stored = this.#load()[pluginId] ?? { server: {}, projects: {} };
    const serverContributions = contributions.filter(
      (contribution) => contribution.scope === "server" && !isPluginSettingSecret(contribution),
    );
    const server = validatePluginSettings(serverContributions, stored.server);
    if (projectId === undefined) return server;
    const projectContributions = contributions.filter(
      (contribution) => contribution.scope === "project" && !isPluginSettingSecret(contribution),
    );
    return {
      ...server,
      ...validatePluginSettings(projectContributions, stored.projects[projectId] ?? {}),
    };
  }

  update(
    pluginId: string,
    projectId: string | undefined,
    contributions: readonly PluginSettingContribution[],
    values: PluginSettingValueMap,
  ): PluginSettingValueMap {
    const targetScope = projectId === undefined ? "server" : "project";
    for (const id of Object.keys(values)) {
      const contribution = contributions.find((item) => item.id === id);
      if (!contribution) throw new Error(`unknown setting: ${id}`);
      if (contribution.scope !== targetScope) {
        throw new Error(`setting ${id} is ${contribution.scope}-scoped`);
      }
    }
    const scopedContributions = contributions.filter(
      (contribution) => contribution.scope === targetScope && !isPluginSettingSecret(contribution),
    );
    const stored = this.#load();
    const current = stored[pluginId] ?? { server: {}, projects: {} };
    const existing = projectId === undefined ? current.server : (current.projects[projectId] ?? {});
    const publicValues = Object.fromEntries(
      Object.entries(values).filter(([id]) => {
        const contribution = contributions.find((item) => item.id === id);
        return contribution !== undefined && !isPluginSettingSecret(contribution);
      }),
    ) as PluginSettingValueMap;
    const next = validatePluginSettings(scopedContributions, { ...existing, ...publicValues });
    if (projectId === undefined) {
      stored[pluginId] = { ...current, server: next };
    } else {
      stored[pluginId] = { ...current, projects: { ...current.projects, [projectId]: next } };
    }
    this.#save(stored);
    return this.get(pluginId, projectId, contributions);
  }

  reset(
    pluginId: string,
    projectId: string | undefined,
    contributions: readonly PluginSettingContribution[],
  ): PluginSettingValueMap {
    const stored = this.#load();
    const current = stored[pluginId] ?? { server: {}, projects: {} };
    if (projectId === undefined) {
      stored[pluginId] = { ...current, server: {} };
    } else {
      const projects = { ...current.projects };
      delete projects[projectId];
      stored[pluginId] = { ...current, projects };
    }
    this.#save(stored);
    return this.get(pluginId, projectId, contributions);
  }

  #load(): StoredSettings {
    try {
      const value: unknown = JSON.parse(NodeFS.readFileSync(this.#path, "utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value)) return {};
      return value as StoredSettings;
    } catch {
      return {};
    }
  }

  #save(value: StoredSettings): void {
    NodeFS.mkdirSync(NodePath.dirname(this.#path), { recursive: true });
    const temporaryPath = `${this.#path}.tmp-${process.pid}`;
    NodeFS.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    NodeFS.renameSync(temporaryPath, this.#path);
  }
}
