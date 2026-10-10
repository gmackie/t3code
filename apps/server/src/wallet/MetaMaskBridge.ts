// @effect-diagnostics nodeBuiltinImport:off - Playwright promises and request fingerprints.
import * as NodeCrypto from "node:crypto";
import * as Schema from "effect/Schema";
import { MetaMaskApproval, MetaMaskError } from "@t3tools/contracts";
import type { Page } from "playwright-core";

const Pending = Schema.Struct({
  id: Schema.String,
  origin: Schema.String,
  type: Schema.String,
  requestData: Schema.optionalKey(Schema.Unknown),
});
const Message = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  msgParams: Schema.Struct({
    from: Schema.String,
    data: Schema.Unknown,
    version: Schema.optionalKey(Schema.String),
  }),
  chainId: Schema.optionalKey(Schema.String),
});
const Transaction = Schema.Struct({
  id: Schema.String,
  chainId: Schema.String,
  txParams: Schema.Struct({
    from: Schema.String,
    to: Schema.String,
    value: Schema.optionalKey(Schema.String),
    data: Schema.optionalKey(Schema.String),
  }),
});
const State = Schema.Struct({
  isUnlocked: Schema.Boolean,
  selectedAddress: Schema.optionalKey(Schema.String),
  pendingApprovals: Schema.Record(Schema.String, Schema.Unknown),
  unapprovedPersonalMsgs: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  unapprovedTypedMessages: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  transactions: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  networkConfigurationsByChainId: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});

const decodeNetworkRequest = Schema.decodeUnknownSync(
  Schema.Struct({
    toNetworkConfiguration: Schema.optionalKey(Schema.Struct({ chainId: Schema.String })),
    chainId: Schema.optionalKey(Schema.String),
    chainName: Schema.optionalKey(Schema.String),
    rpcUrl: Schema.optionalKey(Schema.String),
    ticker: Schema.optionalKey(Schema.String),
    rpcPrefs: Schema.optionalKey(Schema.Struct({ blockExplorerUrl: Schema.String })),
  }),
);
const decodeState = Schema.decodeUnknownSync(State);
const decodePending = Schema.decodeUnknownSync(Pending);
const decodeMessage = Schema.decodeUnknownSync(Message);
const decodeTransaction = Schema.decodeUnknownSync(Transaction);
const decodeApproval = Schema.decodeUnknownSync(MetaMaskApproval);

/** Avoid Playwright's injected utility globals, which MetaMask's LavaMoat deliberately scuttles. */
export async function evaluateMetaMaskPage(
  page: Page,
  expression: string,
  isolated = true,
): Promise<unknown> {
  const session = await page.context().newCDPSession(page);
  try {
    const { frameTree } = await session.send("Page.getFrameTree");
    const { executionContextId } = await session.send("Page.createIsolatedWorld", {
      frameId: frameTree.frame.id,
      worldName: "t3-metamask",
    });
    const result = await session.send("Runtime.evaluate", {
      expression,
      ...(isolated ? { contextId: executionContextId } : {}),
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.exception?.description ?? result.exceptionDetails.text,
      );
    return result.result.value;
  } finally {
    await session.detach();
  }
}

/** Read MetaMask's own state in its trusted extension page, never dapp DOM text. */
export async function readMetaMaskState(page: Page, extensionId: string) {
  if (new URL(page.url()).host !== extensionId || !page.url().startsWith("chrome-extension://")) {
    throw new MetaMaskError({
      code: "unsupported_approval",
      detail: "The wallet bridge must run in the configured MetaMask extension.",
    });
  }
  const state = await evaluateMetaMaskPage(
    page,
    `(() => {
    for (const element of document.querySelectorAll('*')) {
      const key = Object.keys(element).find(key => key.startsWith('__reactFiber$'));
      if (!key) continue;
      let fiber = element[key];
      while (fiber) {
        const store = fiber.memoizedProps?.store;
        if (store && typeof store.getState === 'function') return store.getState().metamask;
        fiber = fiber.return;
      }
    }
    throw new Error('MetaMask UI state is unavailable');
  })()`,
    false,
  );
  return decodeState(state);
}

/** Unknown approval types are visible in MetaMask but never eligible for agent confirmation. */
export function decodeMetaMaskApprovals(raw: unknown) {
  const state = decodeState(raw);
  const approvals: Array<typeof MetaMaskApproval.Type> = [];
  for (const value of Object.values(state.pendingApprovals)) {
    const pending = decodePending(value);
    try {
      if (
        pending.type === "wallet_switchEthereumChain" ||
        pending.type === "wallet_addEthereumChain"
      ) {
        if (!state.isUnlocked || !state.selectedAddress) continue;
        const request = decodeNetworkRequest(pending.requestData);
        approvals.push(
          decodeApproval({
            id: pending.id,
            origin: pending.origin,
            method: pending.type,
            account: state.selectedAddress,
            chainId:
              pending.type === "wallet_switchEthereumChain"
                ? request.toNetworkConfiguration?.chainId
                : request.chainId,
            ...(pending.type === "wallet_addEthereumChain"
              ? {
                  network: {
                    chainName: request.chainName,
                    rpcUrl: request.rpcUrl,
                    ticker: request.ticker,
                    blockExplorerUrl: request.rpcPrefs?.blockExplorerUrl,
                  },
                }
              : {}),
          }),
        );
        continue;
      }
      const transaction = state.transactions?.find(
        (item) =>
          typeof item === "object" && item !== null && "id" in item && item.id === pending.id,
      );
      if (pending.type === "transaction" && transaction !== undefined) {
        const tx = decodeTransaction(transaction);
        approvals.push(
          decodeApproval({
            id: pending.id,
            origin: pending.origin,
            method: "eth_sendTransaction",
            account: tx.txParams.from,
            chainId: tx.chainId,
            transaction: {
              to: tx.txParams.to,
              value: tx.txParams.value ?? "0x0",
              ...(tx.txParams.data ? { data: tx.txParams.data } : {}),
            },
          }),
        );
        continue;
      }
      const source =
        pending.type === "personal_sign"
          ? state.unapprovedPersonalMsgs
          : pending.type === "eth_signTypedData"
            ? state.unapprovedTypedMessages
            : undefined;
      const rawMessage = source?.[pending.id];
      if (rawMessage === undefined) continue;
      const msg = decodeMessage(rawMessage);
      // No fallback to the selected network: the request must carry its own chain.
      if (msg.chainId === undefined) continue;
      if (pending.type === "personal_sign" && typeof msg.msgParams.data === "string") {
        approvals.push(
          decodeApproval({
            id: pending.id,
            origin: pending.origin,
            method: "personal_sign",
            account: msg.msgParams.from,
            chainId: msg.chainId,
            message: msg.msgParams.data,
          }),
        );
      } else if (pending.type === "eth_signTypedData" && msg.msgParams.version === "V4") {
        approvals.push(
          decodeApproval({
            id: pending.id,
            origin: pending.origin,
            method: "eth_signTypedData_v4",
            account: msg.msgParams.from,
            chainId: msg.chainId,
            typedData:
              typeof msg.msgParams.data === "string"
                ? msg.msgParams.data
                : JSON.stringify(msg.msgParams.data),
          }),
        );
      }
    } catch {
      // A malformed or newer request shape needs manual review in MetaMask.
    }
  }
  return { unlocked: state.isUnlocked, approvals };
}

export function approvalFingerprint(approval: typeof MetaMaskApproval.Type) {
  return NodeCrypto.createHash("sha256").update(JSON.stringify(approval)).digest("hex");
}

/** Confirm only the exact request route and a normal enabled confirmation button. */
export async function confirmMetaMaskApproval(page: Page, approval: typeof MetaMaskApproval.Type) {
  return evaluateMetaMaskPage(
    page,
    `(() => {
      const id = ${JSON.stringify(approval.id)};
      const networkMethod = ${JSON.stringify(approval.method === "wallet_switchEthereumChain" || approval.method === "wallet_addEthereumChain")};
      const routes = ['#confirmation/' + encodeURIComponent(id), '#/confirmation/' + encodeURIComponent(id)];
      if (!networkMethod) routes.push('#confirm-transaction/' + encodeURIComponent(id) + ${JSON.stringify(approval.method === "eth_sendTransaction" ? "" : "/signature-request")});
      if (!routes.includes(location.hash)) return false;
      const button = document.querySelector(networkMethod ? '[data-testid="confirmation-submit-button"]' : '[data-testid="confirm-footer-button"]');
      // Review/security-alert flows and disabled/hardware-wallet buttons stay manual.
      if (!(button instanceof HTMLButtonElement) || button.disabled || button.textContent.trim() !== ${JSON.stringify(approval.method === "wallet_switchEthereumChain" ? "Switch network" : approval.method === "wallet_addEthereumChain" ? "Approve" : "Confirm")}) return false;
      button.click(); return true;
    })()`,
  );
}
