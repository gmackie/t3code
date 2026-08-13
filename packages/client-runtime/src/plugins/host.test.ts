import { describe, expect, it } from "vite-plus/test";

import { PluginHost } from "./host.ts";

describe("PluginHost", () => {
  it("does not invoke a disabled plugin and forwards enabled RPC calls", async () => {
    const calls: unknown[] = [];
    const host = new PluginHost({
      send: async (message) => {
        calls.push(message);
        return {
          type: "plugin.response",
          requestId: message.requestId,
          ok: true,
          result: { state: "connected" },
        };
      },
    });
    host.register("bob", "enabled");

    await expect(host.call("bob", "work-source.status", {})).resolves.toEqual({
      state: "connected",
    });
    expect(calls).toHaveLength(1);
  });

  it("surfaces plugin response errors", async () => {
    const host = new PluginHost({
      send: async (message) => ({
        type: "plugin.response",
        requestId: message.requestId,
        ok: false,
        error: "denied",
      }),
    });
    host.register("bob", "enabled");

    await expect(host.call("bob", "threads.read", {})).rejects.toThrow("denied");
  });
});
