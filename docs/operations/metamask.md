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
