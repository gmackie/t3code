// @effect-diagnostics nodeBuiltinImport:off - package installation is a server-side Node boundary.
import * as Schema from "effect/Schema";
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import type { PluginManifest, PluginPackageSource } from "@t3tools/contracts";
import { PluginManifest as PluginManifestSchema } from "@t3tools/contracts";

const decodePluginManifest = Schema.decodeUnknownSync(PluginManifestSchema);

export type PluginCheckout = {
  directory: string;
  commit: string;
};

export type PluginPackageReader = {
  checkout(source: PluginPackageSource): Promise<PluginCheckout>;
  readManifest(directory: string): Promise<unknown>;
};

export type GitCommandRunner = (
  args: readonly string[],
  options?: { readonly cwd?: string },
) => Promise<string>;

export type InstalledPluginPackage = PluginCheckout & {
  pluginId: string;
  source: PluginPackageSource;
  manifest: PluginManifest;
};

export class PluginPackageManager {
  readonly #reader: PluginPackageReader;
  readonly #installed = new Map<string, InstalledPluginPackage>();

  constructor(reader: PluginPackageReader) {
    this.#reader = reader;
  }

  async inspect(source: PluginPackageSource): Promise<InstalledPluginPackage> {
    validateSource(source);
    const checkout = await this.#reader.checkout(source);
    if (source.kind === "git" && checkout.commit !== source.commit) {
      throw new Error(`resolved commit differs from requested pin: ${checkout.commit}`);
    }
    const manifest = decodePluginManifest(await this.#reader.readManifest(checkout.directory));
    return { ...checkout, pluginId: manifest.id, source, manifest };
  }

  async install(source: PluginPackageSource): Promise<InstalledPluginPackage> {
    const packageInfo = await this.inspect(source);
    if (this.#installed.has(packageInfo.pluginId)) {
      throw new Error(`plugin already installed: ${packageInfo.pluginId}`);
    }
    this.#installed.set(packageInfo.pluginId, packageInfo);
    return packageInfo;
  }

  get(pluginId: string): InstalledPluginPackage | undefined {
    return this.#installed.get(pluginId);
  }

  snapshot(): readonly InstalledPluginPackage[] {
    return [...this.#installed.values()];
  }
}

export function createLocalPluginPackageReader(
  root: string,
  runGit: GitCommandRunner = defaultGitCommandRunner,
): PluginPackageReader {
  return {
    async checkout(source) {
      if (source.kind !== "git") {
        throw new Error("catalog package checkout requires a catalog source adapter");
      }
      await NodeFSP.mkdir(root, { recursive: true });
      const directory = await NodeFSP.mkdtemp(NodePath.join(root, "checkout-"));
      await runGit(["clone", "--no-checkout", source.url, directory]);
      await runGit(["-C", directory, "checkout", "--detach", source.commit]);
      const commit = (await runGit(["-C", directory, "rev-parse", "HEAD"])).trim();
      return { directory, commit };
    },
    async readManifest(directory) {
      const contents = await NodeFSP.readFile(NodePath.join(directory, "t3-plugin.json"), "utf8");
      return JSON.parse(contents) as unknown;
    },
  };
}

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

const defaultGitCommandRunner: GitCommandRunner = async (args, options) => {
  const result = await execFile("git", [...args], { cwd: options?.cwd });
  return result.stdout;
};

function validateSource(source: PluginPackageSource): void {
  if (source.kind === "git" && (!source.url || !source.commit)) {
    throw new Error("Git plugin sources require a URL and immutable commit");
  }
  if (source.kind === "catalog" && !source.id) {
    throw new Error("catalog plugin sources require a package ID");
  }
}
