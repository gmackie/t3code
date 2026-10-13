import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeCrypto from "node:crypto";

const root = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");
const forbidden = [
  /@anthropic-ai\/claude-agent-sdk/,
  /@cursor\/sdk/,
  /@clerk[+/]/,
  /effect-codex-app-server/,
  /electron-updater/,
  /(?:provider\/Drivers|orchestration-v2\/Adapters)\/(?:Codex|Claude|Cursor|Grok|Pi|Antigravity|Acp)/,
  /\/src\/sourceControl\/(?:GitHub|Forgejo|AzureDevOps|Bitbucket)/,
  /\/src\/pullRequest\/(?:GitHub|Forgejo|AzureDevOps|Bitbucket)/,
  /\/src\/cloud\/(?:http|selfUpdate|pinnedRuntime|bootService|ManagedEndpointRuntime|serviceLauncherClient)/,
  /\/src\/relay\/AgentAwarenessRelay/,
  /\/src\/ssh\/DesktopSsh/,
  /\/src\/device\/SshDeviceHost/,
  /\/src\/components\/(?:clerk|cloud)\//,
];
const inventory = [];
for (const directory of [
  "apps/server/dist",
  "apps/desktop/dist-electron",
  "apps/web/dist/assets",
]) {
  const names = await NodeFSP.readdir(NodePath.resolve(root, directory));
  const maps = names.filter((name) => name.endsWith(".map"));
  if (maps.length === 0) throw new Error(`Build ${directory} before checking its inventory.`);
  for (const name of maps) {
    const map = JSON.parse(await NodeFSP.readFile(NodePath.resolve(root, directory, name), "utf8"));
    for (const source of map.sources) {
      if (forbidden.some((pattern) => pattern.test(source)))
        throw new Error(`Prohibited runtime in ${directory}/${name}: ${source}`);
    }
  }
  for (const name of names.filter((name) => /\.(?:mjs|cjs|js)$/.test(name))) {
    const content = await NodeFSP.readFile(NodePath.resolve(root, directory, name));
    inventory.push({
      file: `${directory}/${name}`,
      bytes: content.length,
      sha256: NodeCrypto.createHash("sha256").update(content).digest("hex"),
    });
  }
}
for (const name of ["server", "desktop", "web"]) {
  const manifest = JSON.parse(
    await NodeFSP.readFile(NodePath.resolve(root, `apps/${name}/package.json`), "utf8"),
  );
  const dependencies = Object.keys(manifest.dependencies ?? {});
  if (dependencies.some((dependency) => forbidden.some((pattern) => pattern.test(dependency))))
    throw new Error(`Prohibited runtime dependency in apps/${name}/package.json`);
}
process.stdout.write(
  JSON.stringify(
    {
      edition: "T3 Code Locked",
      validation: "bundle source maps and declared runtime dependencies",
      artifacts: inventory.sort((a, b) => a.file.localeCompare(b.file)),
    },
    null,
    2,
  ) + "\n",
);
