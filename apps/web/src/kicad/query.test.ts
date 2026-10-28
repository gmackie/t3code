import { describe, expect, it } from "vite-plus/test";
import { createCachedCadReader } from "./query";

describe("saved Gerber reads", () => {
  it("reuses a prefetched layer until the saved revision changes", async () => {
    let content = "old copper";
    let requests = 0;
    const load = createCachedCadReader(async () => {
      requests++;
      return new Response(content);
    });
    const signal = new AbortController().signal;
    expect(await load("https://cad.test/layer", signal, "revision-1")).toBe("old copper");
    content = "new copper";
    expect(await load("https://cad.test/layer", signal, "revision-1")).toBe("old copper");
    expect(await load("https://cad.test/layer", signal, "revision-2")).toBe("new copper");
    expect(requests).toBe(2);
  });

  it("retries a layer whose earlier render failed", async () => {
    let unavailable = true;
    const load = createCachedCadReader(async () => {
      if (unavailable) throw new Error("renderer disconnected");
      return new Response("recovered layer");
    });
    const signal = new AbortController().signal;
    await expect(load("https://cad.test/layer", signal, "revision")).rejects.toThrow(
      "disconnected",
    );
    unavailable = false;
    expect(await load("https://cad.test/layer", signal, "revision")).toBe("recovered layer");
  });
});
