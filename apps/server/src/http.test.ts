import { describe, expect, it } from "vitest";

import { isAllowedBrowserApiOrigin } from "./http.js";

describe("isAllowedBrowserApiOrigin", () => {
  it("returns false instead of throwing when the origin header is missing", () => {
    expect(isAllowedBrowserApiOrigin(undefined as unknown as string)).toBe(false);
  });

  it("allows the desktop app origin", () => {
    expect(isAllowedBrowserApiOrigin("t3://app")).toBe(true);
  });
});
