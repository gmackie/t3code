// @effect-diagnostics nodeBuiltinImport:off - The synchronous settings resolver uses Node's synchronous digest.
import * as NodeCrypto from "node:crypto";
import type { ProjectId, ResolvedMcpServer, ServerSettings } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";

import type { McpProviderSessionTools } from "@t3tools/provider-core/server/mcpSession";

/**
 * A thread's tools from settings whose secrets are already materialized:
 * the project's overrides applied, disabled servers dropped. The fingerprint
 * covers the full config so a rotated secret also counts as a change; it
 * stays on the server and is only ever compared, never sent or logged.
 */
export function resolveAgentTools(
  settings: ServerSettings,
  projectId: ProjectId | null,
): McpProviderSessionTools {
  const effective = resolveProjectSettings(settings, projectId).settings;
  const servers: ResolvedMcpServer[] = Object.entries(effective.mcpServers)
    .filter(([, server]) => server.enabled)
    .map(([name, server]) => ({ name, transport: server.transport }))
    .toSorted((left, right) => left.name.localeCompare(right.name));
  const disabledSkills = [...new Set(effective.disabledSkills)].toSorted();
  const fingerprint =
    servers.length === 0 && disabledSkills.length === 0
      ? ""
      : NodeCrypto.createHash("sha256")
          .update(JSON.stringify({ servers, disabledSkills }))
          .digest("hex");
  return { servers, disabledSkills, fingerprint };
}

/**
 * Points OAuth servers at T3's proxy (`/mcp/servers/<name>`) under the
 * session's own `/mcp` credential, so a provider never holds an upstream
 * token and refresh happens in one place. The fingerprint stays the
 * settings one: a reissued session token is not a tools change.
 */
export function proxyOAuthServers(
  tools: McpProviderSessionTools,
  session: { readonly endpoint: string; readonly authorizationHeader: string },
): McpProviderSessionTools {
  if (!tools.servers.some((server) => server.transport.type === "http" && server.transport.oauth))
    return tools;
  return {
    ...tools,
    servers: tools.servers.map((server) =>
      server.transport.type === "http" && server.transport.oauth !== undefined
        ? {
            name: server.name,
            transport: {
              type: "http",
              url: new URL(`/mcp/servers/${encodeURIComponent(server.name)}`, session.endpoint)
                .href,
              headers: [
                { name: "Authorization", value: session.authorizationHeader, sensitive: true },
              ],
            },
          }
        : server,
    ),
  };
}
