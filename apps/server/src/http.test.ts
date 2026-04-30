import { describe, expect, it } from "vitest";

import { isAllowedBrowserApiOrigin } from "./http.js";

describe("isAllowedBrowserApiOrigin", () => {
  it("returns false instead of throwing when the origin header is missing", () => {
    expect(isAllowedBrowserApiOrigin(undefined as unknown as string)).toBe(false);
  });

  it("allows the desktop app origin", () => {
    expect(isAllowedBrowserApiOrigin("t3://app")).toBe(true);
  });

  it("allows Expo development client origins used by mobile builds", () => {
    expect(isAllowedBrowserApiOrigin("exp://192.168.1.20:8081")).toBe(true);
    expect(isAllowedBrowserApiOrigin("exps://example.ngrok-free.dev")).toBe(true);
    expect(isAllowedBrowserApiOrigin("exp+t3-code-mobile://expo-development-client")).toBe(true);
  });

  it("allows the T3 Code mobile app scheme origin", () => {
    expect(isAllowedBrowserApiOrigin("t3code-mobile://pair")).toBe(true);
  });
});
