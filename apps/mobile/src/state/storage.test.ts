import { describe, expect, it } from "vitest";

import { createInMemoryMobileStorage } from "./storage";

describe("mobile storage", () => {
  it("round-trips session tokens in memory", async () => {
    const storage = createInMemoryMobileStorage();

    await storage.setItem("session", "abc");

    await expect(storage.getItem("session")).resolves.toBe("abc");
  });
});
