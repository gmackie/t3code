# Browse with MetaMask

MetaMask runs in your environment's browser, so the same wallet and website are available from web,
desktop, and mobile. Ask your environment administrator to configure MetaMask first, then select
**MetaMask** as your browser profile under **Settings → Integrations → Browser profiles**. Complete
wallet setup and unlock in MetaMask itself. Wallet storage stays on the server between sessions.

An agent can open the wallet with `metamask_open`, which starts at `https://attest.gmac.io` by default.
Connect the website and choose its network in MetaMask. Agents can use `metamask_status` to read
the connected public addresses, current network, and native balances without requesting wallet access. You can review and confirm requests directly
in the browser from any connected device.

## Give an agent wallet access

Wallet actions are denied until the environment administrator grants them for your thread, website,
account, network, and RPC methods. Transaction grants also set a recipient list, native-currency value
limit, expiry, and whether contract calls are allowed. Remove a grant to revoke it; approval checks
read the current grants again immediately before confirming.

Agents use `metamask_request` to prepare a request, `metamask_pending` to inspect its exact intent, and
`metamask_approve` to confirm it within a matching grant. Connection prompts, wallet unlock,
hardware-wallet steps, security warnings, and unsupported confirmations require your review in
MetaMask. Agent confirmation currently supports MetaMask 13.5.0 in English.

Each request has a stable ID. `metamask_request_status` reports its result. If a server restart leaves
it **unknown**, check MetaMask and chain history before creating another request; the same ID is
never automatically sent again. “Submitted” means confirmation was requested, not that a transaction
has been mined.

One thread uses the wallet profile at a time. `metamask_close` closes its browser session and releases
it for another thread, while retaining wallet storage. Regular browser profile cleanup cannot delete
this wallet.

Agents with explicit network-method grants can request `wallet_switchEthereumChain` and confirm
the matching prompt. If Sepolia is missing, `wallet_addEthereumChain` adds the fixed Sepolia preset;
this requires its own grant. Network permissions do not permit signatures or transactions.
