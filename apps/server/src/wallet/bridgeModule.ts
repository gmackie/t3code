// @effect-diagnostics nodeBuiltinImport:off - Operator-installed, integrity-pinned wallet adapter.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { MetaMaskError, type MetaMaskConfiguration } from "@t3tools/contracts";
import * as bundled from "./MetaMaskBridge.ts";

// Only stateless extension integration is replaceable. Ownership, grants, request
// journals and the approval lock remain in the running wallet service.
const exports = [
  "readMetaMaskState",
  "decodeMetaMaskApprovals",
  "approvalFingerprint",
  "metaMaskApprovalPresentation",
  "confirmMetaMaskApproval",
  "editMetaMaskFees",
] as const;
type Bridge = Pick<typeof bundled, (typeof exports)[number]>;
let cached: { digest: string; bridge: Bridge } | undefined;

export async function loadWalletBridge(
  module: MetaMaskConfiguration["bridgeModule"],
): Promise<Bridge> {
  if (!module) return bundled;
  if (!NodePath.isAbsolute(module.path))
    throw new MetaMaskError({
      code: "unavailable",
      detail: "Wallet bridge path must be absolute.",
    });
  const bytes = await NodeFSP.readFile(module.path);
  const digest = NodeCrypto.createHash("sha256").update(bytes).digest("hex");
  if (digest !== module.sha256)
    throw new MetaMaskError({
      code: "unavailable",
      detail: "Wallet bridge checksum mismatch; wallet actions are disabled.",
    });
  if (cached?.digest === digest) return cached.bridge;
  // Import exactly the verified bytes, avoiding a path replacement between hash and import.
  const candidate: unknown = await import(
    /* @vite-ignore */ `data:text/javascript;base64,${bytes.toString("base64")}`
  );
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    !("walletBridgeApiVersion" in candidate) ||
    candidate.walletBridgeApiVersion !== 1 ||
    !exports.every((key) => key in candidate && typeof Reflect.get(candidate, key) === "function")
  ) {
    throw new MetaMaskError({
      code: "unavailable",
      detail: "Wallet bridge API is incompatible; install a version 1 bridge.",
    });
  }
  const bridge = candidate as unknown as Bridge;
  cached = { digest, bridge };
  return bridge;
}
