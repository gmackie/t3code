import { describe, expect, it } from "vite-plus/test";

import { makeWorkSourceProvider } from "./workSource.ts";

describe("work source provider", () => {
  it("exposes provider-neutral list and detail operations", async () => {
    const provider = makeWorkSourceProvider({
      id: "bob",
      displayName: "Bob",
      capabilities: ["list", "detail"],
      getStatus: async () => ({ state: "connected" }),
      list: async () => [
        {
          providerId: "bob",
          id: "work-1",
          title: "Plan plugin migration",
          status: { id: "active", label: "Active", category: "active" },
          scope: { projectId: "project-1" },
        },
      ],
      get: async (itemId) => ({
        item: {
          providerId: "bob",
          id: itemId,
          title: "Plan plugin migration",
          status: { id: "active", label: "Active", category: "active" },
          scope: { projectId: "project-1" },
        },
      }),
    });

    expect(await provider.list({ projectId: "project-1" })).toHaveLength(1);
    expect((await provider.get("work-1")).item.providerId).toBe("bob");
  });
});
