// @effect-diagnostics nodeBuiltinImport:off - release metadata is read by the build process.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

export type PluginReleaseEntry = {
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  readonly source: {
    readonly kind: "git";
    readonly url: string;
    readonly commit: string;
  };
  readonly manifestPath: string;
};

export type PluginReleaseCatalog = {
  readonly schemaVersion: 1;
  readonly plugins: readonly PluginReleaseEntry[];
};

const CATALOG_RELATIVE_PATH = "docs/plugins/release-catalog.json";

export function readPluginReleaseCatalog(repoRoot: string): PluginReleaseCatalog {
  const catalogPath = NodePath.join(repoRoot, CATALOG_RELATIVE_PATH);
  const parsed = JSON.parse(NodeFS.readFileSync(catalogPath, "utf8")) as PluginReleaseCatalog;
  validatePluginReleaseCatalog(parsed);
  return parsed;
}

export function validatePluginReleaseCatalog(catalog: PluginReleaseCatalog): void {
  if (catalog.schemaVersion !== 1) {
    throw new Error("unsupported plugin catalog schema: " + catalog.schemaVersion);
  }
  const ids = new Set<string>();
  for (const plugin of catalog.plugins) {
    if (ids.has(plugin.id)) throw new Error("duplicate plugin id: " + plugin.id);
    ids.add(plugin.id);
    if (!plugin.id.startsWith("com.t3code.") || plugin.id.length <= "com.t3code.".length) {
      throw new Error("invalid plugin id: " + plugin.id);
    }
    if (
      !plugin.source.url.startsWith("https://github.com/gmackie/t3code-") ||
      !plugin.source.url.endsWith("-plugin.git")
    ) {
      throw new Error("plugin source must be an immutable GMACKO GitHub repository: " + plugin.id);
    }
    if (!/^[0-9a-f]{40}$/u.test(plugin.source.commit)) {
      throw new Error("plugin source must pin a full commit: " + plugin.id);
    }
    if (plugin.manifestPath.includes("..") || NodePath.isAbsolute(plugin.manifestPath)) {
      throw new Error("plugin manifest path escapes package root: " + plugin.id);
    }
  }
}

export function stagePluginReleaseCatalog(input: {
  readonly repoRoot: string;
  readonly stageResourcesDir: string;
}): string {
  const catalog = readPluginReleaseCatalog(input.repoRoot);
  const destination = NodePath.join(input.stageResourcesDir, "plugins", "release-catalog.json");
  NodeFS.mkdirSync(NodePath.dirname(destination), { recursive: true });
  NodeFS.writeFileSync(destination, JSON.stringify(catalog, null, 2) + "\n", "utf8");
  return destination;
}

if (import.meta.main) {
  const repoRoot = NodePath.resolve(NodePath.dirname(new URL(import.meta.url).pathname), "..");
  const catalog = readPluginReleaseCatalog(repoRoot);
  process.stdout.write("validated " + catalog.plugins.length + " plugin release entries\n");
}
