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
    method: "personal_sign" | "eth_sendTransaction",
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
