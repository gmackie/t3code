/** Build the independently installable MetaMask adapter, without web or desktop builds. */
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

const output = NodePath.resolve(process.argv[2] ?? "apps/server/dist-wallet");
const result = NodeChildProcess.spawnSync(
  "pnpm",
  [
    "exec",
    "vp",
    "pack",
    "apps/server/src/wallet/MetaMaskBridge.ts",
    "--no-config",
    "--deps.always-bundle",
    "/.*/",
    "--out-dir",
    output,
  ],
  { stdio: "inherit" },
);
if (result.status !== 0) throw new Error("Wallet adapter build failed");
const bytes = await NodeFSP.readFile(NodePath.join(output, "MetaMaskBridge.mjs"));
const sha256 = NodeCrypto.createHash("sha256").update(bytes).digest("hex");
// A content-addressed name keeps a previous installation available for rollback.
const artifact = NodePath.join(output, `wallet-bridge-${sha256}.mjs`);
await NodeFSP.mkdir(output, { recursive: true });
await NodeFSP.writeFile(artifact, bytes, { mode: 0o600 });
await NodeFSP.writeFile(
  NodePath.join(output, "bridge-module.json"),
  JSON.stringify({ path: artifact, sha256 }, null, 2) + "\n",
);
console.log(
  `Wallet adapter built: ${artifact}\nConfiguration entry: ${NodePath.join(output, "bridge-module.json")}`,
);
