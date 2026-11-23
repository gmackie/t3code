// A stdio MCP server for McpClientPool tests. Each tool reports facts about
// this process so tests can tell connections apart.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new McpServer({ name: "pool-fixture", version: "1.0.0" });

server.registerTool("whoami", { description: "Process facts" }, async () => {
  const extensions = server.server.getClientCapabilities()?.extensions ?? {};
  return {
    content: [{ type: "text", text: "ok" }],
    structuredContent: {
      pid: process.pid,
      token: process.env.FIXTURE_TOKEN ?? null,
      stateHome: process.env.XDG_STATE_HOME ?? null,
      t3Callback: process.env.T3_MCP_TOKEN
        ? { url: process.env.T3_MCP_URL, token: process.env.T3_MCP_TOKEN }
        : null,
      uiExtension: extensions["io.modelcontextprotocol/ui"] ?? null,
    },
  };
});

server.registerTool(
  "model_only",
  { description: "Hidden from views", _meta: { ui: { visibility: ["model"] } } },
  async () => ({ content: [{ type: "text", text: "model only" }] }),
);

// Exits before answering, so the caller sees the connection close.
server.registerTool("crash", { description: "Exit the process" }, async () => process.exit(1));

server.registerResource(
  "panel",
  "ui://fixture/panel",
  { mimeType: "text/html;profile=mcp-app" },
  async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "text/html;profile=mcp-app", text: "<p>panel</p>" }],
  }),
);

await server.connect(new StdioServerTransport());
