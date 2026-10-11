/** Install a trusted locally built adapter; never alter the desktop app bundle. */
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

const [manifestArg, configArg] = process.argv.slice(2);
if (!manifestArg || !configArg)
  throw new Error(
    "Usage: node scripts/install-wallet-bridge.ts <bridge-module.json> <wallet-config.json>",
  );
const manifest: unknown = JSON.parse(await NodeFSP.readFile(NodePath.resolve(manifestArg), "utf8"));
if (
  typeof manifest !== "object" ||
  manifest === null ||
  !("path" in manifest) ||
  typeof manifest.path !== "string" ||
  !NodePath.isAbsolute(manifest.path) ||
  !("sha256" in manifest) ||
  typeof manifest.sha256 !== "string"
)
  throw new Error("Invalid wallet adapter manifest");
const bytes = await NodeFSP.readFile(manifest.path);
const sha256 = NodeCrypto.createHash("sha256").update(bytes).digest("hex");
if (sha256 !== manifest.sha256) throw new Error("Wallet adapter checksum mismatch");
const configPath = NodePath.resolve(configArg);
const original = await NodeFSP.readFile(configPath, "utf8");
const config: unknown = JSON.parse(original);
if (
  typeof config !== "object" ||
  config === null ||
  !("grants" in config) ||
  !Array.isArray(config.grants)
)
  throw new Error("Invalid wallet configuration");
const directory = NodePath.join(NodePath.dirname(configPath), "bridges");
await NodeFSP.mkdir(directory, { recursive: true, mode: 0o700 });
const artifact = NodePath.join(directory, `wallet-bridge-${sha256}.mjs`);
await NodeFSP.writeFile(artifact, bytes, { mode: 0o600 });
const temporary = `${configPath}.${NodeCrypto.randomUUID()}.tmp`;
try {
  await NodeFSP.writeFile(
    temporary,
    JSON.stringify({ ...config, bridgeModule: { path: artifact, sha256 } }, null, 2) + "\n",
    { mode: 0o600, flag: "wx" },
  );
  if ((await NodeFSP.readFile(configPath, "utf8")) !== original)
    throw new Error(
      "Wallet configuration changed during installation; retry to preserve the new settings",
    );
  await NodeFSP.rename(temporary, configPath);
} finally {
  await NodeFSP.unlink(temporary).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}
console.log(
  `Installed wallet adapter ${sha256}. A loader-enabled server uses it on the next wallet action. Older servers require a one-time server update.`,
);
