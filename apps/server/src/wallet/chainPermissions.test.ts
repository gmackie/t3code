import { describe, expect, it } from "vite-plus/test";
import { decodeMetaMaskApprovals, approvalFingerprint } from "./MetaMaskBridge.ts";

const account = "0x1111111111111111111111111111111111111111";
const origin = "https://attest.gmac.io";
const capability = "endowment:caip25";
function fixture(isMultichainOrigin = false) {
  const currentValue = {
    requiredScopes: {},
    optionalScopes: {
      "wallet:eip155": { accounts: [`wallet:eip155:${account}`] },
      "eip155:1": { accounts: [] },
    },
    sessionProperties: {},
    isMultichainOrigin,
  };
  const current = {
    [capability]: {
      id: "permission-id",
      parentCapability: capability,
      invoker: origin,
      date: 1,
      caveats: [{ type: "authorizedScopes", value: currentValue }],
    },
  };
  const delta = {
    requiredScopes: {},
    optionalScopes: { "eip155:11155111": { accounts: [] as string[] } },
    sessionProperties: {},
    isMultichainOrigin,
  };
  return {
    isUnlocked: true,
    internalAccounts: {
      selectedAccount: "account-id",
      accounts: { "account-id": { address: account, type: "eip155:eoa" } },
    },
    subjects: { [origin]: { permissions: current } },
    pendingApprovals: {
      network: {
        id: "network",
        origin,
        type: "wallet_requestPermissions",
        requestData: {
          metadata: { id: "network", origin, isSwitchEthereumChain: true },
          permissions: {
            [capability]: {
              ...current[capability],
              caveats: [
                {
                  type: "authorizedScopes",
                  value: {
                    ...currentValue,
                    optionalScopes: { ...currentValue.optionalScopes, ...delta.optionalScopes },
                  },
                },
              ],
            },
          },
          diff: {
            currentPermissions: current,
            permissionDiffMap: { [capability]: { authorizedScopes: delta } },
          },
        },
      },
    },
  };
}
describe("incremental MetaMask chain permissions", () => {
  it("recognizes only a chain extension preserving existing account access", () => {
    const [approval] = decodeMetaMaskApprovals(fixture()).approvals;
    expect(approval).toMatchObject({
      id: "network",
      origin,
      account,
      chainId: "0xaa36a7",
      method: "wallet_switchEthereumChain",
      chainPermission: { chainIds: ["0x1", "0xaa36a7"] },
    });
    expect(approval?.chainPermission?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
  it("preserves an existing multichain origin when adding one chain", () => {
    const raw = fixture(true);
    expect(decodeMetaMaskApprovals(raw).approvals).toMatchObject([
      { method: "wallet_switchEthereumChain", chainId: "0xaa36a7" },
    ]);
    raw.pendingApprovals.network.requestData.diff.permissionDiffMap[
      capability
    ].authorizedScopes.isMultichainOrigin = false;
    expect(decodeMetaMaskApprovals(raw).approvals).toEqual([]);
  });
  it("recognizes Attest's existing per-chain account scopes without expanding them", () => {
    const raw = fixture(true);
    const request = raw.pendingApprovals.network.requestData;
    const value = raw.subjects[origin].permissions[capability].caveats[0]!.value;
    value.optionalScopes["wallet:eip155"].accounts = [];
    Object.assign(value.optionalScopes, {
      "eip155:1": { accounts: [`eip155:1:${account}`] },
      "eip155:59144": { accounts: [`eip155:59144:${account}`] },
      "eip155:8453": { accounts: [`eip155:8453:${account}`] },
    });
    request.permissions[capability].caveats[0]!.value.optionalScopes = {
      ...value.optionalScopes,
      "eip155:11155111": { accounts: [] },
    };
    expect(decodeMetaMaskApprovals(raw).approvals).toMatchObject([
      {
        chainId: "0xaa36a7",
        chainPermission: { chainIds: ["0x1", "0xe708", "0x2105", "0xaa36a7"] },
      },
    ]);
    request.permissions[capability].caveats[0]!.value.isMultichainOrigin = false;
    expect(decodeMetaMaskApprovals(raw).approvals).toEqual([]);
  });
  it("leaves changed permission intent unsupported", () => {
    const mutations = [
      (raw: ReturnType<typeof fixture>) => {
        raw.pendingApprovals.network.requestData.metadata.isSwitchEthereumChain = false;
      },
      (raw: ReturnType<typeof fixture>) => {
        raw.pendingApprovals.network.requestData.metadata.origin = "https://other.example";
      },
      (raw: ReturnType<typeof fixture>) => {
        raw.pendingApprovals.network.requestData.metadata.id = "another-id";
      },
      (raw: ReturnType<typeof fixture>) => {
        raw.isUnlocked = false;
      },
      (raw: ReturnType<typeof fixture>) => {
        raw.internalAccounts.accounts["account-id"].address =
          "0x2222222222222222222222222222222222222222";
      },
      (raw: ReturnType<typeof fixture>) => {
        raw.pendingApprovals.network.requestData.diff.permissionDiffMap[
          capability
        ].authorizedScopes.optionalScopes["eip155:11155111"].accounts.push(
          `wallet:eip155:${account}`,
        );
      },
      (raw: ReturnType<typeof fixture>) => {
        raw.pendingApprovals.network.requestData.permissions[
          capability
        ].caveats[0]!.value.optionalScopes["wallet:eip155"].accounts.push(
          "wallet:eip155:0x2222222222222222222222222222222222222222",
        );
      },
      (raw: ReturnType<typeof fixture>) => {
        Reflect.deleteProperty(raw.subjects[origin].permissions, capability);
      },
    ];
    for (const mutate of mutations) {
      const raw = fixture();
      mutate(raw);
      expect(decodeMetaMaskApprovals(raw).approvals).toEqual([]);
      expect(decodeMetaMaskApprovals(raw).unsupportedApprovals).toHaveLength(1);
    }
  });
  it("rejects extra permissions, chains and hidden scope fields", () => {
    for (const extra of [
      { wallet_snap: {} },
      {
        [capability]: {
          authorizedScopes: {
            ...fixture().pendingApprovals.network.requestData.diff.permissionDiffMap[capability]
              .authorizedScopes,
            optionalScopes: {
              "eip155:11155111": { accounts: [], methods: ["eth_sendTransaction"] },
            },
          },
        },
      },
      {
        [capability]: {
          authorizedScopes: {
            ...fixture().pendingApprovals.network.requestData.diff.permissionDiffMap[capability]
              .authorizedScopes,
            optionalScopes: { "eip155:11155111": { accounts: [] }, "eip155:10": { accounts: [] } },
          },
        },
      },
    ]) {
      const raw = fixture();
      expect(
        decodeMetaMaskApprovals({
          ...raw,
          pendingApprovals: {
            network: {
              ...raw.pendingApprovals.network,
              requestData: {
                ...raw.pendingApprovals.network.requestData,
                diff: {
                  ...raw.pendingApprovals.network.requestData.diff,
                  permissionDiffMap: {
                    ...raw.pendingApprovals.network.requestData.diff.permissionDiffMap,
                    ...extra,
                  },
                },
              },
            },
          },
        }).approvals,
      ).toEqual([]);
    }
  });
  it("binds the fingerprint to the complete unchanged permission snapshot", () => {
    const raw = fixture();
    const [before] = decodeMetaMaskApprovals(raw).approvals;
    const changed = fixture();
    changed.pendingApprovals.network.requestData.permissions[capability].date = 2;
    changed.pendingApprovals.network.requestData.diff.currentPermissions[capability].date = 2;
    const [after] = decodeMetaMaskApprovals(changed).approvals;
    if (!before || !after) throw new Error("Missing fixture approvals");
    expect(approvalFingerprint(before)).not.toBe(approvalFingerprint(after));
  });
});
