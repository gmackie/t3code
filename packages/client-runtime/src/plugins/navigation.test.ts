import { describe, expect, it } from "vite-plus/test";
import { PluginRegistry } from "./registry.ts";
import {
  buildPluginNavigationUrl,
  buildPluginPanelUrl,
  listPluginNavigation,
  listPluginQuickNav,
  listPluginQuickNavFromEntries,
} from "./navigation.ts";

describe("plugin navigation", () => {
  it("returns navigation only for enabled plugins and preserves plugin paths", () => {
    const registry = new PluginRegistry();
    const manifest = {
      schemaVersion: 1 as const,
      id: "com.example.veritas",
      displayName: "Veritas",
      version: "1.0.0",
      runtime: {
        kind: "managed-app" as const,
        command: ["veritas"],
        restart: "on-failure" as const,
      },
      contributes: {
        navigation: [{ id: "veritas.overview", title: "Overview", path: "/" }],
        panels: [
          {
            id: "veritas.thread-run",
            title: "Verification",
            surface: "thread.sidePanel" as const,
          },
        ],
        workflows: [{ id: "veritas.review", title: "Review", surface: "thread.main" as const }],
      },
      capabilities: [],
    };
    registry.install({
      manifest,
      source: { kind: "git", url: "https://example.test/veritas", commit: "abc" },
    });
    expect(listPluginNavigation(registry)).toEqual([]);
    registry.enable(manifest.id);
    expect(listPluginNavigation(registry)).toEqual([
      {
        pluginId: manifest.id,
        displayName: "Veritas",
        id: "veritas.overview",
        title: "Overview",
        path: "/",
      },
    ]);
    expect(
      buildPluginNavigationUrl(manifest.id, "/runs/r1", { projectId: "p1", threadId: "t1" }),
    ).toBe("/plugins/com.example.veritas/runs/r1?projectId=p1&threadId=t1");
    expect(buildPluginPanelUrl(manifest.id, "veritas.thread-run", { threadId: "t1" })).toBe(
      "/plugins/com.example.veritas?panel=veritas.thread-run&threadId=t1",
    );
    expect(listPluginQuickNav(registry, { projectId: "p1" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "navigation", id: "veritas.overview" }),
        expect.objectContaining({
          kind: "panel",
          id: "veritas.thread-run",
          href: "/plugins/com.example.veritas?panel=veritas.thread-run&projectId=p1",
        }),
        expect.objectContaining({
          kind: "workflow",
          id: "veritas.review",
          href: "/plugins/com.example.veritas?workflow=veritas.review&projectId=p1",
        }),
      ]),
    );
  });

  it("maps enabled server registry entries into project and thread links", () => {
    expect(
      listPluginQuickNavFromEntries(
        [
          {
            pluginId: "com.example.forgegraph",
            displayName: "ForgeGraph",
            version: "1.0.0",
            source: { kind: "catalog", id: "forgegraph" },
            health: { pluginId: "com.example.forgegraph", state: "healthy" },
            capabilities: [],
            grants: [],
            settings: [],
            settingsPanels: [],
            navigation: [{ id: "delivery", title: "Delivery", path: "/" }],
            panels: [{ id: "pr-status", title: "PR status", surface: "thread.sidePanel" }],
            workflows: [
              { id: "delivery-review", title: "Delivery review", surface: "thread.main" },
            ],
          },
          {
            pluginId: "com.example.disabled",
            displayName: "Disabled",
            version: "1.0.0",
            source: { kind: "catalog", id: "disabled" },
            health: { pluginId: "com.example.disabled", state: "stopped" },
            capabilities: [],
            grants: [],
            settings: [],
            settingsPanels: [],
            navigation: [{ id: "hidden", title: "Hidden", path: "/" }],
            panels: [],
            workflows: [],
          },
        ],
        { projectId: "p1", threadId: "t1" },
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          href: "/plugins/com.example.forgegraph/?projectId=p1&threadId=t1",
        }),
        expect.objectContaining({
          href: "/plugins/com.example.forgegraph?panel=pr-status&projectId=p1&threadId=t1",
        }),
        expect.objectContaining({
          href: "/plugins/com.example.forgegraph?workflow=delivery-review&projectId=p1&threadId=t1",
        }),
      ]),
    );
  });
});
