import {
  MetaMaskError,
  METAMASK_SEPOLIA,
  type MetaMaskApproval,
  type MetaMaskGrant,
  type MetaMaskRequestInput,
} from "@t3tools/contracts";

/** The same check runs before submission and again immediately before approval. */
export function requireWalletGrant(
  grants: ReadonlyArray<MetaMaskGrant>,
  threadId: string,
  request: MetaMaskRequestInput | MetaMaskApproval,
  now: number,
) {
  if (request.method === "wallet_addEthereumChain") {
    if (
      request.chainId !== METAMASK_SEPOLIA.chainId ||
      ("network" in request &&
        (request.network?.chainName !== METAMASK_SEPOLIA.chainName ||
          request.network?.rpcUrl !== METAMASK_SEPOLIA.rpcUrl ||
          request.network?.ticker !== METAMASK_SEPOLIA.ticker ||
          request.network?.blockExplorerUrl !== METAMASK_SEPOLIA.blockExplorerUrl))
    )
      throw new MetaMaskError({
        code: "permission_denied",
        detail: "Only the pinned Sepolia network preset can be added.",
      });
  }
  const origin = new URL(request.origin).origin;
  const grant = grants.find(
    (candidate) =>
      candidate.threadId === threadId &&
      candidate.origin === origin &&
      request.origin === origin &&
      candidate.account.toLowerCase() === request.account.toLowerCase() &&
      BigInt(candidate.chainId) === BigInt(request.chainId) &&
      candidate.methods.includes(request.method) &&
      Date.parse(candidate.expiresAt) > now &&
      (request.transaction === undefined ||
        (BigInt(request.transaction.value) <= BigInt(candidate.maxValueWei) &&
          candidate.recipients.some(
            (recipient) => recipient.toLowerCase() === request.transaction?.to.toLowerCase(),
          ) &&
          (candidate.allowContractCalls ||
            !request.transaction.data ||
            request.transaction.data === "0x"))),
  );
  if (!grant)
    throw new MetaMaskError({
      code: "permission_denied",
      detail:
        "No current wallet grant matches this thread, origin, method, account, chain, recipient and value.",
    });
  return grant;
}

export function walletRpcParameters(request: MetaMaskRequestInput): ReadonlyArray<unknown> {
  switch (request.method) {
    case "eth_requestAccounts":
      return [];
    case "wallet_switchEthereumChain":
      return [{ chainId: request.chainId }];
    case "wallet_addEthereumChain":
      if (request.chainId === METAMASK_SEPOLIA.chainId)
        return [
          {
            chainId: METAMASK_SEPOLIA.chainId,
            chainName: METAMASK_SEPOLIA.chainName,
            rpcUrls: [METAMASK_SEPOLIA.rpcUrl],
            nativeCurrency: {
              name: "Sepolia Ether",
              symbol: METAMASK_SEPOLIA.ticker,
              decimals: 18,
            },
            blockExplorerUrls: [METAMASK_SEPOLIA.blockExplorerUrl],
          },
        ];
      break;
    case "personal_sign":
      if (request.message !== undefined) return [request.message, request.account];
      break;
    case "eth_signTypedData_v4":
      if (request.typedData !== undefined) {
        const data: unknown = JSON.parse(request.typedData);
        if (
          typeof data === "object" &&
          data !== null &&
          "domain" in data &&
          typeof data.domain === "object" &&
          data.domain !== null &&
          "chainId" in data.domain &&
          BigInt(String(data.domain.chainId)) === BigInt(request.chainId)
        ) {
          return [request.account, request.typedData];
        }
      }
      break;
    case "eth_sendTransaction":
      if (request.transaction !== undefined)
        return [{ ...request.transaction, from: request.account }];
      break;
  }
  throw new MetaMaskError({
    code: "request_failed",
    detail:
      "The wallet request is missing its method-specific data, or its typed-data chain does not match.",
  });
}
