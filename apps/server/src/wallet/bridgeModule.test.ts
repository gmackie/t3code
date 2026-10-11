import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, expect, it } from "vite-plus/test";
import { loadWalletBridge } from "./bridgeModule.ts";

const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await NodeFSP.rm(dir, { recursive: true, force: true });
});
const moduleSource = (version: number, marker: number) => `
export const walletBridgeApiVersion = ${version};
export const readMetaMaskState = () => ${marker};
export const decodeMetaMaskApprovals = () => {};
export const approvalFingerprint = () => '';
export const metaMaskApprovalPresentation = () => {};
export const confirmMetaMaskApproval = () => false;
export const editMetaMaskFees = () => {};
`;
async function fixture(source: string) {
  const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "wallet-bridge-"));
  dirs.push(dir);
  const file = NodePath.join(dir, "bridge.mjs");
  await NodeFSP.writeFile(file, source);
  return { path: file, sha256: NodeCrypto.createHash("sha256").update(source).digest("hex") };
}
it("reloads verified standalone adapter bytes without replacing the wallet service", async () => {
  const first = await fixture(moduleSource(1, 1));
  const a = await loadWalletBridge(first);
  expect(await a.readMetaMaskState({} as never, "")).toBe(1);
  const second = moduleSource(1, 2);
  await NodeFSP.writeFile(first.path, second);
  await expect(loadWalletBridge(first)).rejects.toThrow("checksum mismatch");
  const b = await loadWalletBridge({
    ...first,
    sha256: NodeCrypto.createHash("sha256").update(second).digest("hex"),
  });
  expect(await b.readMetaMaskState({} as never, "")).toBe(2);
  expect(await loadWalletBridge(undefined)).not.toBe(b);
});
it("fails closed on incompatible or incomplete modules", async () => {
  await expect(loadWalletBridge(await fixture(moduleSource(2, 1)))).rejects.toThrow("incompatible");
  await expect(
    loadWalletBridge(await fixture("export const walletBridgeApiVersion = 1")),
  ).rejects.toThrow("incompatible");
});
