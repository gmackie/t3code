import { describe, expect, it } from "vite-plus/test";

import { makeCompatibilityWorkSourceProvider } from "./compatibility.ts";

describe("compatibility work source", () => {
  it("translates legacy provider payloads at the boundary", async () => {
    const provider = makeCompatibilityWorkSourceProvider({
      id: "bob",
      displayName: "Bob",
      capabilities: ["list", "detail"],
      legacy: {
        list: async () => [{ key: "BOB-1", name: "Legacy item", state: "active" }],
        get: async () => ({ key: "BOB-1", name: "Legacy item", state: "active" }),
      },
      normalizeItem: (raw) => ({
        providerId: "bob",
        id: raw.key,
        title: raw.name,
        status: { id: raw.state, label: raw.state, category: "active" },
        scope: {},
      }),
    });

    expect((await provider.list({}))[0]?.id).toBe("BOB-1");
    expect((await provider.get("BOB-1")).item.title).toBe("Legacy item");
  });
});
