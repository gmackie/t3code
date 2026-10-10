import * as NodeVM from "node:vm";
import type { Page } from "playwright-core";
import { describe, expect, it, vi } from "vite-plus/test";
import {
  approvalFingerprint,
  confirmMetaMaskApproval,
  decodeMetaMaskApprovals,
} from "./MetaMaskBridge.ts";

const account = "0x1111111111111111111111111111111111111111";
const recipient = "0x2222222222222222222222222222222222222222";
const state = {
  isUnlocked: true,
  pendingApprovals: { tx: { id: "tx", origin: "https://attest.gmac.io", type: "transaction" } },
  transactions: [
    { id: "tx", chainId: "0x1", txParams: { from: account, to: recipient, value: "0x1" } },
  ],
};
describe("MetaMask approval decoding", () => {
  it("uses trusted transaction state and preserves the exact origin, account, chain and value", () => {
    expect(decodeMetaMaskApprovals(state)).toEqual({
      unlocked: true,
      unsupportedApprovals: [],
      approvals: [
        {
          id: "tx",
          origin: "https://attest.gmac.io",
          method: "eth_sendTransaction",
          account,
          chainId: "0x1",
          transaction: { to: recipient, value: "0x1" },
        },
      ],
    });
  });
  it("leaves unsupported and incomplete approval shapes for manual confirmation", () => {
    expect(decodeMetaMaskApprovals({ ...state, transactions: [] }).approvals).toEqual([]);
    expect(
      decodeMetaMaskApprovals({
        ...state,
        pendingApprovals: { tx: { ...state.pendingApprovals.tx, type: "wallet_addEthereumChain" } },
      }).approvals,
    ).toEqual([]);
  });
  it("reports unsupported permission requests without exposing request data", () => {
    const result = decodeMetaMaskApprovals({
      isUnlocked: true,
      pendingApprovals: {
        permissions: {
          id: "permissions",
          origin: "https://attest.gmac.io",
          type: "wallet_requestPermissions",
          requestData: { metadata: { isSwitchEthereumChain: true }, secret: "never-return-this" },
        },
      },
      vault: "never-return-this-either",
    });
    expect(result.approvals).toEqual([]);
    expect(result.unsupportedApprovals).toEqual([
      { id: "permissions", origin: "https://attest.gmac.io", type: "wallet_requestPermissions" },
    ]);
    expect(JSON.stringify(result)).not.toContain("never-return");
  });
  it("reports malformed supported requests instead of silently hiding them", () => {
    expect(decodeMetaMaskApprovals({ ...state, transactions: [] }).unsupportedApprovals).toEqual([
      { id: "tx", origin: "https://attest.gmac.io", type: "transaction" },
    ]);
  });
  it("changes the fingerprint when transaction intent changes", () => {
    const [approval] = decodeMetaMaskApprovals(state).approvals;
    if (!approval) throw new Error("Missing test approval");
    expect(approvalFingerprint(approval)).not.toBe(
      approvalFingerprint({ ...approval, transaction: { to: account, value: "0x1" } }),
    );
  });
  it("does not infer a signature's chain from the wallet's selected network", () => {
    const raw = {
      isUnlocked: true,
      pendingApprovals: {
        msg: { id: "msg", origin: "https://attest.gmac.io", type: "personal_sign" },
      },
      unapprovedPersonalMsgs: {
        msg: { id: "msg", type: "personal_sign", msgParams: { from: account, data: "0x1234" } },
      },
    };
    expect(decodeMetaMaskApprovals(raw).approvals).toEqual([]);
    expect(
      decodeMetaMaskApprovals({
        ...raw,
        unapprovedPersonalMsgs: { msg: { ...raw.unapprovedPersonalMsgs.msg, chainId: "0x1" } },
      }).approvals,
    ).toHaveLength(1);
  });
});

describe("MetaMask confirmation guard", () => {
  async function confirm(
    hash: string,
    method:
      | "personal_sign"
      | "eth_sendTransaction"
      | "wallet_switchEthereumChain"
      | "wallet_addEthereumChain",
    disabled = false,
    label = "Confirm",
  ) {
    class Button {
      disabled = disabled;
      textContent = label;
      click = vi.fn();
    }
    const button = new Button();
    const detach = vi.fn(async () => undefined);
    const session = {
      send: async (command: string, parameters?: { expression?: string }) => {
        if (command === "Page.getFrameTree") return { frameTree: { frame: { id: "frame" } } };
        if (command === "Page.createIsolatedWorld") return { executionContextId: 1 };
        return {
          result: {
            value: NodeVM.runInNewContext(parameters!.expression!, {
              location: { hash },
              document: { querySelector: () => button },
              HTMLButtonElement: Button,
            }),
          },
        };
      },
      detach,
    };
    const page = { context: () => ({ newCDPSession: async () => session }) } as unknown as Page;
    const result = await confirmMetaMaskApproval(page, {
      id: "request-a",
      origin: "https://attest.gmac.io",
      method,
      account,
      chainId: "0x1",
    });
    expect(detach).toHaveBeenCalledOnce();
    return { result, button };
  }
  it("confirms the pinned MetaMask signature and transaction routes", async () => {
    for (const [hash, method] of [
      ["#confirm-transaction/request-a/signature-request", "personal_sign"],
      ["#confirmation/request-a", "eth_sendTransaction"],
      ["#confirm-transaction/request-a", "eth_sendTransaction"],
    ] as const) {
      const { result, button } = await confirm(hash, method);
      expect(result).toBe(true);
      expect(button.click).toHaveBeenCalledOnce();
    }
  });
  it("confirms only the exact network confirmation route and expected action", async () => {
    for (const [method, label] of [
      ["wallet_switchEthereumChain", "Switch network"],
      ["wallet_addEthereumChain", "Approve"],
    ] as const) {
      expect((await confirm("#confirmation/request-a", method, false, label)).result).toBe(true);
      expect((await confirm("#confirmation/request-b", method, false, label)).result).toBe(false);
      expect(
        (await confirm("#confirm-transaction/request-a/signature-request", method, false, label))
          .result,
      ).toBe(false);
      expect((await confirm("#confirmation/request-a", method, true, label)).result).toBe(false);
      expect(
        (await confirm("#confirmation/request-a", method, false, "Proceed anyway")).result,
      ).toBe(false);
    }
  });
  it("refuses another request, review routes, disabled buttons and warning actions", async () => {
    for (const [hash, disabled, label] of [
      ["#confirm-transaction/request-b/signature-request", false, "Confirm"],
      ["#confirm-transaction/request-a/signature-request/review", false, "Confirm"],
      ["#confirm-transaction/request-a/signature-request", true, "Confirm"],
      ["#confirm-transaction/request-a/signature-request", false, "Proceed anyway"],
    ] as const) {
      const { result, button } = await confirm(hash, "personal_sign", disabled, label);
      expect(result).toBe(false);
      expect(button.click).not.toHaveBeenCalled();
    }
  });
});

describe("trusted network request decoding", () => {
  const raw = {
    ...state,
    selectedAddress: account,
    pendingApprovals: {
      network: {
        id: "network",
        origin: "https://attest.gmac.io",
        type: "wallet_switchEthereumChain",
        requestData: {
          toNetworkConfiguration: { chainId: "0xaa36a7" },
          fromNetworkConfiguration: { chainId: "0x1" },
        },
      },
    },
  };
  it("uses the requested target chain and current wallet account", () => {
    expect(decodeMetaMaskApprovals(raw).approvals).toEqual([
      {
        id: "network",
        origin: "https://attest.gmac.io",
        method: "wallet_switchEthereumChain",
        account,
        chainId: "0xaa36a7",
      },
    ]);
  });
  it("leaves locked or incomplete network requests unsupported", () => {
    expect(decodeMetaMaskApprovals({ ...raw, isUnlocked: false }).approvals).toEqual([]);
    expect(decodeMetaMaskApprovals({ ...raw, selectedAddress: "" }).approvals).toEqual([]);
    expect(
      decodeMetaMaskApprovals({
        ...raw,
        pendingApprovals: { network: { ...raw.pendingApprovals.network, requestData: {} } },
      }).approvals,
    ).toEqual([]);
  });
  it("fingerprints network endpoint changes", () => {
    const add = {
      ...raw,
      pendingApprovals: {
        network: {
          ...raw.pendingApprovals.network,
          type: "wallet_addEthereumChain",
          requestData: {
            chainId: "0xaa36a7",
            chainName: "Sepolia",
            rpcUrl: "https://11155111.rpc.thirdweb.com",
            ticker: "ETH",
            rpcPrefs: { blockExplorerUrl: "https://sepolia.etherscan.io" },
          },
        },
      },
    };
    const [approval] = decodeMetaMaskApprovals(add).approvals;
    expect(approval?.network?.rpcUrl).toBe("https://11155111.rpc.thirdweb.com");
    if (!approval?.network) throw new Error("Missing fixture");
    expect(approvalFingerprint(approval)).not.toBe(
      approvalFingerprint({
        ...approval,
        network: { ...approval.network, rpcUrl: "https://other.example" },
      }),
    );
  });
});
