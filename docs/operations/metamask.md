# Configure server MetaMask

MetaMask needs full extension-capable Chromium; the default Chrome headless shell stays in use for
ordinary browsing. Install a Chrome for Testing / Playwright Chromium executable and unpack the
[official MetaMask 13.5.0 Chrome release](https://github.com/MetaMask/metamask-extension/releases/tag/v13.5.0)
on the environment host. The approval adapter is version-pinned and leaves other versions disabled.
Keep the executable and extension outside the wallet profile storage directory.

Create a host-owned JSON configuration and set `T3CODE_METAMASK_CONFIG` to its absolute path when
starting T3. With `grants: []`, people can browse and use MetaMask manually, but agents cannot submit
or approve wallet RPC requests. Chromium derives the extension ID; an optional `extensionId` pins an
expected ID and refuses mismatches.

```json
{
  "chromiumExecutable": "/absolute/path/to/chromium",
  "extensionDirectory": "/absolute/path/to/metamask-13.5.0",
  "extensionVersion": "13.5.0",
  "grants": []
}
```

Add an explicit grant after choosing the actual thread ID, account, chain, methods, and expiry.
This example permits signatures on chain 1 for the sample account; replace those values before use.
No grant is created automatically for the default Attest website.

```json
{
  "threadId": "your-thread-id",
  "origin": "https://attest.gmac.io",
  "account": "0x1111111111111111111111111111111111111111",
  "chainId": "0x1",
  "methods": ["personal_sign", "eth_signTypedData_v4"],
  "expiresAt": "2026-12-01T00:00:00Z",
  "maxValueWei": "0x0",
  "recipients": [],
  "allowContractCalls": false
}
```

Use hexadecimal quantities for chain IDs and native transaction values. `maxValueWei` caps the sent
native value, excluding gas; it does not cap token transfers. For transactions, explicitly list
recipient addresses. Set `allowContractCalls: true` only when the grant is intended to permit
arbitrary contract calldata to those recipients. Signature grants permit messages for the selected
methods, including authorizations encoded in typed data. Replace the file atomically to change or
revoke grants; the service rereads it for each action.

Wallet storage lives under `userdata/server-browser/profiles/metamask` within this environment's
T3 home. Setup, password entry, recovery phrases, and unlocking remain in MetaMask's UI. Back up the
wallet through MetaMask's own workflow. The request journal under `server-browser/wallet-requests`
is retained across restarts and must not be discarded to retry a pending operation.

Grants constrain MCP wallet actions and ordinary preview tools cannot control wallet tabs. They are
not host filesystem isolation: full-access agents can run commands on the server. If an agent must
not access the configuration or wallet storage, enforce that separation at the host/container level.

Desktop clients stream wallet tabs from the server instead of rendering another Electron wallet.
Mobile uses the existing browser stream; no native wallet or local signing keys are installed on the
phone. Chromium's sandbox remains enabled. On Linux, ensure the chosen full Chromium executable has
its required libraries and host sandbox permission; `t3 browser setup` configures the default
headless shell, not arbitrary external executables.

For agent-driven Sepolia setup, grant `wallet_switchEthereumChain` on chain `0xaa36a7`
for the connected account and thread. If the network is absent, separately grant
`wallet_addEthereumChain`; this method only adds the pinned Sepolia RPC/explorer preset.
Both methods use the request journal and exact approval fingerprint checks. Neither grant
permits signing or sending transactions. Revoke setup grants when setup is complete.

## Fee limits and adapter updates

Transaction grants now need `maxGasFeeWei` in addition to `maxValueWei`. The
maximum gas cost is `gas * maxFeePerGas` (or `gas * gasPrice` for legacy
transactions); it is separate from the amount sent. Old value-only grants
continue to support their non-transaction methods, but cannot authorize a
transaction. Requests must specify a positive gas limit and either both
EIP-1559 prices or a legacy gas price, as hexadecimal quantities in wei.
Pending approvals expose these fields and include them in their fingerprint.

`metamask_update_fees` edits one pending EIP-1559 transaction using its current
fingerprint. It requires a grant for the proposed maximum fee, rechecks the
transaction and grant before saving, and never confirms the transaction.
Read `metamask_pending` again and verify the saved fees before approval.
Security alerts and unsupported layouts still require manual review.

The stateless MetaMask adapter can be updated independently of the desktop:

```sh
node scripts/build-wallet-bridge.ts /absolute/path/to/wallet-build
node scripts/install-wallet-bridge.ts /absolute/path/to/wallet-build/bridge-module.json /absolute/path/to/metamask/config.json
```

The installer copies a content-addressed module beside the configuration and
atomically changes its `bridgeModule` entry, preserving grants and other host
settings. Wallet actions reread this entry and verify the module checksum;
checksum or API mismatches disable the action rather than falling back.
Remove `bridgeModule` to return to the bundled adapter. Install only trusted
locally built adapters: these are executable host code, not wallet permissions.

This mechanism requires a server that includes the adapter loader. Older
servers, including the initial MetaMask release, need a one-time server update
and restart first. Installing a bridge alone cannot add new MCP schemas to an
older running server. Browser ownership, journals and permission enforcement
remain in the server and require a server update when changed. Building this
adapter does not build or sign a desktop app.
