// A dependency-free MCP server over stdio: one tool and one MCP Apps view.
// Run it with any Node; T3 Code starts it from the plugin's t3-plugin.json.
import * as NodeFS from "node:fs";
import * as NodeReadline from "node:readline";

const VIEW_URI = "ui://hello/status";
const VIEW_MIME = "text/html;profile=mcp-app";
const view = NodeFS.readFileSync(new URL("./view.html", import.meta.url), "utf8");

const tool = {
  name: "hello_status",
  description: "Greets you and reports when the plugin's server last answered.",
  inputSchema: { type: "object", properties: {} },
  annotations: { readOnlyHint: true, title: "Hello status" },
  _meta: { ui: { resourceUri: VIEW_URI, visibility: ["model", "app"] } },
};

const handlers = {
  initialize: (params) => ({
    protocolVersion: params?.protocolVersion ?? "2025-06-18",
    capabilities: { tools: {}, resources: {} },
    serverInfo: { name: "hello", version: "0.1.0" },
  }),
  ping: () => ({}),
  "tools/list": () => ({ tools: [tool] }),
  "tools/call": (params) => {
    if (params?.name !== tool.name) throw new Error(`Unknown tool ${params?.name}`);
    const greeting = `Hello, ${process.env.HELLO_NAME || "there"}!`;
    const answeredAt = new Date().toISOString();
    return {
      content: [{ type: "text", text: `${greeting} (${answeredAt})` }],
      structuredContent: { greeting, answeredAt },
    };
  },
  "resources/list": () => ({
    resources: [{ uri: VIEW_URI, name: "Hello status", mimeType: VIEW_MIME }],
  }),
  "resources/read": (params) => {
    if (params?.uri !== VIEW_URI) throw new Error(`Unknown resource ${params?.uri}`);
    return { contents: [{ uri: VIEW_URI, mimeType: VIEW_MIME, text: view }] };
  },
};

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

NodeReadline.createInterface({ input: process.stdin }).on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.id === undefined) return; // notifications need no answer
  const handler = handlers[message.method];
  if (!handler) {
    send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
    return;
  }
  try {
    send({ jsonrpc: "2.0", id: message.id, result: handler(message.params) });
  } catch (error) {
    send({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32602, message: String(error.message) },
    });
  }
});
