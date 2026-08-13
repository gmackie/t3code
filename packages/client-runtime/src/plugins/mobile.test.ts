import { describe, expect, it } from "vite-plus/test";

import { PluginHost } from "./host.ts";
import { MobilePluginBridge } from "./mobile.ts";

describe("MobilePluginBridge", () => {
  it("exposes generic work-item and run operations without provider imports", async () => {
    const host = new PluginHost({
      send: async (message) => ({
        type: "plugin.response" as const,
        requestId: message.requestId,
        ok: true as const,
        result:
          message.method === "work-source.list"
            ? []
            : [{ providerId: "bob", id: "run-1", status: "running" }],
      }),
    });
    host.register("bob", "enabled");
    const bridge = new MobilePluginBridge(host);

    expect(await bridge.listWorkItems("bob", { projectId: "project-1" })).toEqual([]);
    expect(await bridge.listRuns("bob", "work-1")).toEqual([
      { providerId: "bob", id: "run-1", status: "running" },
    ]);
  });

  it("loads native plugin surface cards through the same bridge", async () => {
    const host = new PluginHost({
      send: async (message) => ({
        type: "plugin.response" as const,
        requestId: message.requestId,
        ok: true as const,
        result: {
          pluginId: "veritas",
          navigationId: "veritas.overview",
          title: "Verification cockpit",
          refreshedAt: new Date().toISOString(),
          cards: [{ kind: "metric", id: "active-runs", title: "Active runs", value: "1" }],
        },
      }),
    });
    host.register("veritas", "enabled");
    const bridge = new MobilePluginBridge(host);
    await expect(bridge.getSurface("veritas", "veritas.overview")).resolves.toMatchObject({
      pluginId: "veritas",
      cards: [{ id: "active-runs" }],
    });
  });

  it("loads serial and verification panels through the generic bridge", async () => {
    const host = new PluginHost({
      send: async (message) => ({
        type: "plugin.response" as const,
        requestId: message.requestId,
        ok: true as const,
        result:
          message.method === "panel.get"
            ? {
                pluginId: "veritas",
                panelId: "veritas.thread-run",
                title: "Verification",
                kind: "verification",
                refreshedAt: new Date().toISOString(),
                content: {
                  kind: "verification",
                  status: "passed",
                  summary: "All checks passed",
                  runs: [],
                },
              }
            : { status: "completed", message: "done" },
      }),
    });
    host.register("veritas", "enabled");
    const bridge = new MobilePluginBridge(host);
    await expect(
      bridge.getPanel({ pluginId: "veritas", panelId: "veritas.thread-run" }),
    ).resolves.toMatchObject({ kind: "verification", content: { status: "passed" } });
    await expect(
      bridge.runAction({ pluginId: "veritas", actionId: "veritas.trigger-run", input: {} }),
    ).resolves.toMatchObject({ status: "completed" });
  });
});
