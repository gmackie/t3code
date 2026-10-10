import {
  MetaMaskApproval,
  MetaMaskError,
  MetaMaskRequestInput,
  MetaMaskRequestResult,
  MetaMaskWalletStatus,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as ServerBrowser from "../../../preview/ServerBrowser.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: MetaMaskError,
  dependencies: [ServerBrowser.ServerBrowser, McpInvocationContext.McpInvocationContext],
};
const Open = Tool.make("metamask_open", {
  ...shared,
  description:
    "Open the persistent server MetaMask profile and its website in this thread. Defaults to https://attest.gmac.io. Setup and unlock stay in the human-controlled wallet UI, accessible from mobile. Requires host MetaMask configuration. Ordinary preview tools cannot control this wallet profile.",
  parameters: Schema.Struct({ url: Schema.optionalKey(Schema.String) }),
  success: Schema.Struct({ tabId: Schema.String, profileId: Schema.String, origin: Schema.String }),
})
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, true);
const Pending = Tool.make("metamask_pending", {
  ...shared,
  description:
    "Read supported MetaMask signature/transaction confirmations from the extension's own state. Returns an immutable fingerprint for each approval. Includes supported network switch and Sepolia-add confirmations. Unsupported confirmations and connection prompts require manual review. Never returns vaults or seed phrases.",
  success: Schema.Struct({
    unlocked: Schema.Boolean,
    approvals: Schema.Array(
      Schema.Struct({ ...MetaMaskApproval.fields, fingerprint: Schema.String }),
    ),
  }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);
const Status = Tool.make("metamask_status", {
  ...shared,
  description:
    "Read the connected public accounts, chain ID and native balances for an already-open wallet website. Uses eth_accounts without requesting access or prompting. Defaults to Attest; other origins require a current thread grant. Never returns wallet secrets or submits transactions.",
  parameters: Schema.Struct({ origin: Schema.optionalKey(Schema.String) }),
  success: MetaMaskWalletStatus,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);
const Request = Tool.make("metamask_request", {
  ...shared,
  description:
    "Submit a wallet RPC request from a granted website. Requires an explicit unexpired grant for this thread, origin, method, account and chain; transactions also require recipient, native value and contract-call permission. Supply a stable clientRequestId: retries never resend. Returns pending immediately; use metamask_pending to inspect, metamask_approve to confirm, and metamask_request_status for the result. Network switching and adding the fixed Sepolia preset require explicit matching grants; inspect and approve supported prompts with metamask_pending/metamask_approve. Connection prompts are manual.",
  parameters: MetaMaskRequestInput,
  success: MetaMaskRequestResult,
})
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true);
const Result = Tool.make("metamask_request_status", {
  ...shared,
  description:
    "Read the journaled result of a wallet request in this thread. A request interrupted by server restart is unknown and is never automatically resent; inspect MetaMask and chain history before issuing a new request ID.",
  parameters: Schema.Struct({ clientRequestId: Schema.String }),
  success: MetaMaskRequestResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);
const Approve = Tool.make("metamask_approve", {
  ...shared,
  description:
    "Confirm one supported MetaMask signature, transaction or network change using its approvalId and fingerprint from metamask_pending. Rereads host grants immediately before confirmation. Checks trusted extension state, not website text. Security warnings, hardware-wallet prompts, unknown layouts and unsupported versions require manual review. Submitted means the Confirm button was invoked; inspect metamask_request_status for the final result.",
  parameters: Schema.Struct({ approvalId: Schema.String, fingerprint: Schema.String }),
  success: Schema.Struct({ approvalId: Schema.String, status: Schema.Literal("submitted") }),
})
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true);
const Close = Tool.make("metamask_close", {
  ...shared,
  description:
    "Close this thread's wallet browser session without deleting persistent wallet storage. Ends its tabs and releases it for another thread. Pending wallet requests may become unknown; inspect chain history before retrying them.",
  success: Schema.Struct({ closed: Schema.Boolean }),
}).annotate(Tool.Destructive, true);
export const MetaMaskToolkit = Toolkit.make(Open, Pending, Status, Request, Result, Approve, Close);
