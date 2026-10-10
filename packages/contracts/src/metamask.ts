import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const METAMASK_BROWSER_PROFILE_ID = "metamask";
export const METAMASK_DEFAULT_SITE = "https://attest.gmac.io";
// Approval decoding and confirmation selectors are deliberately versioned together.
export const METAMASK_SUPPORTED_VERSION = "13.5.0";
const Address = Schema.String.check(Schema.isPattern(/^0x[0-9a-fA-F]{40}$/));
const Quantity = Schema.String.check(Schema.isPattern(/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/));
const Data = Schema.String.check(Schema.isPattern(/^0x(?:[0-9a-fA-F]{2})*$/));
export const MetaMaskMethod = Schema.Literals([
  "eth_requestAccounts",
  "wallet_switchEthereumChain",
  "personal_sign",
  "eth_signTypedData_v4",
  "eth_sendTransaction",
]);
export const MetaMaskGrant = Schema.Struct({
  threadId: TrimmedNonEmptyString,
  origin: Schema.String.check(Schema.isPattern(/^https:\/\/[^/?#]+$/)),
  account: Address,
  chainId: Quantity,
  methods: Schema.Array(MetaMaskMethod),
  expiresAt: Schema.String,
  maxValueWei: Quantity,
  recipients: Schema.Array(Address),
  allowContractCalls: Schema.Boolean,
});
export type MetaMaskGrant = typeof MetaMaskGrant.Type;
export const MetaMaskConfiguration = Schema.Struct({
  chromiumExecutable: TrimmedNonEmptyString,
  extensionDirectory: TrimmedNonEmptyString,
  extensionId: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^[a-p]{32}$/))),
  extensionVersion: Schema.Literal(METAMASK_SUPPORTED_VERSION),
  grants: Schema.Array(MetaMaskGrant),
});
export type MetaMaskConfiguration = typeof MetaMaskConfiguration.Type;
export const MetaMaskRequestInput = Schema.Struct({
  clientRequestId: TrimmedNonEmptyString,
  method: MetaMaskMethod,
  chainId: Quantity,
  account: Address,
  origin: Schema.String,
  message: Schema.optionalKey(Data),
  typedData: Schema.optionalKey(Schema.String),
  transaction: Schema.optionalKey(
    Schema.Struct({
      to: Address,
      value: Quantity,
      data: Schema.optionalKey(Data),
    }),
  ),
});
export type MetaMaskRequestInput = typeof MetaMaskRequestInput.Type;
export const MetaMaskApproval = Schema.Struct({
  id: Schema.String,
  origin: Schema.String,
  method: Schema.Literals(["personal_sign", "eth_signTypedData_v4", "eth_sendTransaction"]),
  account: Address,
  chainId: Quantity,
  message: Schema.optionalKey(Data),
  typedData: Schema.optionalKey(Schema.String),
  transaction: MetaMaskRequestInput.fields.transaction,
});
export type MetaMaskApproval = typeof MetaMaskApproval.Type;
export const MetaMaskWalletStatus = Schema.Struct({
  origin: Schema.String,
  unlocked: Schema.Boolean,
  chainId: Quantity,
  accounts: Schema.Array(Schema.Struct({ address: Address, balanceWei: Quantity })),
});
export const MetaMaskRequestResult = Schema.Struct({
  requestId: Schema.String,
  status: Schema.Literals(["pending", "completed", "failed", "unknown"]),
  result: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(Schema.String),
});
export type MetaMaskRequestResult = typeof MetaMaskRequestResult.Type;
export class MetaMaskError extends Schema.TaggedError<MetaMaskError>()("MetaMaskError", {
  code: Schema.Literals([
    "unavailable",
    "permission_denied",
    "unsupported_approval",
    "busy",
    "request_failed",
  ]),
  detail: Schema.String,
}) {
  override get message(): string {
    return this.detail;
  }
}
