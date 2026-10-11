import { describe, expect, it } from "vite-plus/test";
import {
  METAMASK_SEPOLIA,
  type MetaMaskGrant,
  type MetaMaskRequestInput,
} from "@t3tools/contracts";
import { requireWalletGrant, walletRpcParameters } from "./permissions.ts";

const account = "0x1111111111111111111111111111111111111111";
const recipient = "0x2222222222222222222222222222222222222222";
const now = Date.parse("2026-10-09T00:00:00Z");
const grant: MetaMaskGrant = {
  threadId: "thread-a",
  origin: "https://attest.gmac.io",
  account,
  chainId: "0x1",
  methods: ["eth_sendTransaction", "eth_signTypedData_v4", "personal_sign"],
  expiresAt: "2026-10-10T00:00:00Z",
  maxValueWei: "0xa",
  maxGasFeeWei: "0x5208",
  recipients: [recipient],
  allowContractCalls: false,
};
const fees = { gas: "0x5208", maxFeePerGas: "0x1", maxPriorityFeePerGas: "0x1" };
const request: MetaMaskRequestInput = {
  clientRequestId: "request-a",
  origin: grant.origin,
  method: "eth_sendTransaction",
  account,
  chainId: "0x1",
  transaction: { ...fees, to: recipient, value: "0xa" },
};

describe("MetaMask grants", () => {
  it("allows an exact grant and denies absent, revoked or expired grants", () => {
    expect(requireWalletGrant([grant], "thread-a", request, now)).toBe(grant);
    expect(() => requireWalletGrant([], "thread-a", request, now)).toThrow(
      "No current wallet grant",
    );
    expect(() =>
      requireWalletGrant([grant], "thread-a", request, Date.parse(grant.expiresAt)),
    ).toThrow();
  });
  it.each([
    { origin: "https://attest.gmac.io.evil.example" },
    { origin: "https://attest.gmac.io/path" },
    { origin: "https://attest.gmac.io:444" },
    { account: recipient },
    { chainId: "0x2" },
    { method: "eth_requestAccounts" as const },
    { transaction: { ...fees, to: account, value: "0xa" } },
    { transaction: { ...fees, to: recipient, value: "0xb" } },
    { transaction: { ...fees, to: recipient, value: "0x0", data: "0x1234" } },
  ])("denies a request outside the grant: %j", (change) => {
    expect(() => requireWalletGrant([grant], "thread-a", { ...request, ...change }, now)).toThrow();
  });
  it("prevents another thread from using the grant", () => {
    expect(() => requireWalletGrant([grant], "thread-b", request, now)).toThrow();
  });
  it("only permits contract calldata when the user explicitly allows it", () => {
    const call = {
      ...request,
      transaction: { ...fees, to: recipient, value: "0x0", data: "0x1234" },
    };
    expect(() =>
      requireWalletGrant([{ ...grant, allowContractCalls: true }], "thread-a", call, now),
    ).not.toThrow();
  });
  it("builds RPC parameters without allowing caller-supplied sender overrides", () => {
    expect(walletRpcParameters(request)).toEqual([
      { ...fees, from: account, to: recipient, value: "0xa" },
    ]);
    const { transaction: _transaction, ...withoutTransaction } = request;
    expect(() => walletRpcParameters(withoutTransaction)).toThrow();
  });
  it("rejects typed data whose domain chain differs from the granted chain", () => {
    const sign = {
      ...request,
      method: "eth_signTypedData_v4" as const,
      typedData: JSON.stringify({ domain: { chainId: 2 } }),
    };
    expect(() => walletRpcParameters(sign)).toThrow();
    expect(
      walletRpcParameters({ ...sign, typedData: JSON.stringify({ domain: { chainId: 1 } }) }),
    ).toEqual([account, '{"domain":{"chainId":1}}']);
  });
});

describe("network setup permissions", () => {
  const setup = {
    clientRequestId: request.clientRequestId,
    account: request.account,
    origin: request.origin,
    method: "wallet_addEthereumChain" as const,
    chainId: METAMASK_SEPOLIA.chainId,
  };
  const networkGrant = {
    ...grant,
    chainId: setup.chainId,
    methods: ["wallet_addEthereumChain" as const],
  };
  it("requires an explicit grant and pins Sepolia parameters", () => {
    expect(() => requireWalletGrant([], "thread-a", setup, now)).toThrow();
    expect(requireWalletGrant([networkGrant], "thread-a", setup, now)).toBe(networkGrant);
    expect(walletRpcParameters(setup)).toEqual([
      {
        chainId: "0xaa36a7",
        chainName: "Sepolia",
        rpcUrls: [METAMASK_SEPOLIA.rpcUrl],
        nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
        blockExplorerUrls: [METAMASK_SEPOLIA.blockExplorerUrl],
      },
    ]);
    expect(() => walletRpcParameters({ ...setup, chainId: "0x1" })).toThrow();
    expect(() =>
      requireWalletGrant(
        [{ ...networkGrant, chainId: "0x1" }],
        "thread-a",
        { ...setup, chainId: "0x1" },
        now,
      ),
    ).toThrow("pinned Sepolia");
  });
  it("refuses changed RPC configuration and revocation before approval", () => {
    const approval = {
      id: "add",
      origin: setup.origin,
      account,
      chainId: setup.chainId,
      method: setup.method,
      network: {
        chainName: METAMASK_SEPOLIA.chainName,
        rpcUrl: METAMASK_SEPOLIA.rpcUrl,
        ticker: METAMASK_SEPOLIA.ticker,
        blockExplorerUrl: METAMASK_SEPOLIA.blockExplorerUrl,
      },
    };
    expect(requireWalletGrant([networkGrant], "thread-a", approval, now)).toBe(networkGrant);
    expect(() =>
      requireWalletGrant(
        [networkGrant],
        "thread-a",
        { ...approval, network: { ...approval.network, rpcUrl: "https://evil.example" } },
        now,
      ),
    ).toThrow("pinned Sepolia");
    expect(() => requireWalletGrant([], "thread-a", approval, now)).toThrow();
  });
});

describe("transaction fee permissions", () => {
  it("enforces worst-case gas cost even when transfer value is allowed", () => {
    const tx = { ...request, transaction: { ...request.transaction!, maxFeePerGas: "0x2" } };
    expect(() => requireWalletGrant([grant], "thread-a", tx, now)).toThrow("maximum gas fee");
    expect(
      requireWalletGrant([{ ...grant, maxGasFeeWei: "0xa410" }], "thread-a", tx, now),
    ).toBeDefined();
  });
  it("old value-only grants do not authorize transaction gas", () => {
    const { maxGasFeeWei: _, ...old } = grant;
    expect(() => requireWalletGrant([old], "thread-a", request, now)).toThrow();
  });
  it.each([
    {},
    { gas: "0x5208" },
    { gas: "0x0", gasPrice: "0x1" },
    { gas: "0x5208", maxFeePerGas: "0x1" },
    { ...fees, gasPrice: "0x1" },
    { ...fees, maxPriorityFeePerGas: "0x2" },
    { gas: "0x5208", gasPrice: "0x0" },
  ])("denies missing, mixed or inconsistent fees: %j", (fee) => {
    expect(() =>
      requireWalletGrant(
        [grant],
        "thread-a",
        { ...request, transaction: { to: recipient, value: "0xa", ...fee } },
        now,
      ),
    ).toThrow();
  });
  it("permits a fully bounded legacy transaction", () => {
    expect(
      requireWalletGrant(
        [grant],
        "thread-a",
        {
          ...request,
          transaction: { to: recipient, value: "0xa", gas: "0x5208", gasPrice: "0x1" },
        },
        now,
      ),
    ).toBe(grant);
  });
});
