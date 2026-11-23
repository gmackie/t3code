# MCP plugins

A plugin is a v2 manifest ([`mcpPlugin.ts`](../../packages/contracts/src/mcpPlugin.ts)) naming one
MCP server and the `ui://` views its panels show. Installing it writes a plugin-owned Settings →
Tools entry ([`McpPlugins.ts`](../../apps/server/src/plugins/McpPlugins.ts)), so agents, secrets
and project overrides need nothing plugin-specific.

## The server owns every plugin connection

Panels reach the plugin's server through the environment's
[`McpClientPool`](../../apps/server/src/mcp/McpClientPool.ts), never from a client. Clients only
send typed `mcpApps.*` RPCs, so local, Tailscale, relay, tunnel and mobile connections behave the
same, and a plugin's secrets never leave the environment. A thread item's app still goes through
the provider session that produced it.

## Two copies of a stdio plugin

Each provider session spawns its own copy of a stdio plugin from the Tools entry, and the pool runs
one more for panels. In-memory state therefore diverges between them; stateful plugins keep state
in their backend or a file under `XDG_STATE_HOME` (the pool inherits the server's environment for
this reason), or use an http transport.

Only the pool's copy gets `T3_MCP_URL` and `T3_MCP_TOKEN`, a credential limited to the manifest's
`t3Tools`. Tokens in provider launch config would leak into provider logs, and agents already have
the `t3-code` server.
