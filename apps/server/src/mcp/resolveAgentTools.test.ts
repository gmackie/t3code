import { describe, expect, it } from "@effect/vitest";

import { proxyOAuthServers } from "./resolveAgentTools.ts";

describe("proxyOAuthServers", () => {
  it("routes only OAuth servers through T3 with the session credential", () => {
    const tools = {
      servers: [
        {
          name: "linear",
          transport: {
            type: "http" as const,
            url: "https://mcp.example/mcp",
            headers: [],
            auth: { type: "oauth" as const, scopes: [] },
          },
        },
        {
          name: "local",
          transport: { type: "stdio" as const, command: "local-mcp", args: [], env: [] },
        },
      ],
      disabledSkills: [],
      fingerprint: "settings-fingerprint",
    };
    const proxied = proxyOAuthServers(tools, {
      endpoint: "http://127.0.0.1:3773/mcp",
      authorizationHeader: "Bearer session-token",
    });
    expect(proxied.fingerprint).toBe("settings-fingerprint");
    expect(proxied.servers).toEqual([
      {
        name: "linear",
        transport: {
          type: "http",
          url: "http://127.0.0.1:3773/mcp/servers/linear",
          headers: [{ name: "Authorization", value: "Bearer session-token", sensitive: true }],
        },
      },
      tools.servers[1],
    ]);
  });
});
