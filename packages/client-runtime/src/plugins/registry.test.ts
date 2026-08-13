import { describe, expect, it } from "vite-plus/test";

import { PluginRegistry } from "./registry.ts";

const manifest = {
  schemaVersion: 1 as const,
  id: "com.example.bob",
  displayName: "Bob",
  version: "1.0.0",
  runtime: {
    kind: "attached" as const,
    endpoint: "http://127.0.0.1:4310",
    transport: "http" as const,
  },
  contributes: {},
  capabilities: [{ kind: "threads.read" as const, projectIds: ["project-1"] }],
};

describe("PluginRegistry", () => {
  it("requires explicit grants before enabling a plugin", () => {
    const registry = new PluginRegistry();
    registry.install({
      manifest,
      source: { kind: "git", url: "https://example.com/bob.git", commit: "abc123" },
    });

    expect(registry.get("com.example.bob").state).toBe("installed");
    expect(() => registry.enable("com.example.bob")).toThrow("capability grant");

    registry.grant("com.example.bob", manifest.capabilities[0]!);
    registry.enable("com.example.bob");
    expect(registry.get("com.example.bob").state).toBe("enabled");
  });

  it("revokes access and disables contributions", () => {
    const registry = new PluginRegistry();
    registry.install({ manifest, source: { kind: "catalog", id: "bob" } });
    registry.grant("com.example.bob", manifest.capabilities[0]!);
    registry.enable("com.example.bob");

    registry.revoke("com.example.bob", manifest.capabilities[0]!);

    expect(registry.get("com.example.bob").state).toBe("installed");
    expect(registry.get("com.example.bob").grants).toHaveLength(0);
  });
});
