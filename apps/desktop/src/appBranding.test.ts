import { describe, expect, it } from "vitest";

import { getDesktopAppDisplayName } from "./appBranding.js";

describe("getDesktopAppDisplayName", () => {
  it("uses the gmacko app name for packaged macOS builds", () => {
    expect(getDesktopAppDisplayName({ isDevelopment: false, platform: "darwin" })).toBe(
      "T3 Code (gmacko)",
    );
    expect(getDesktopAppDisplayName({ isDevelopment: false, platform: "mac" })).toBe(
      "T3 Code (gmacko)",
    );
  });

  it("keeps the dev app name in development", () => {
    expect(getDesktopAppDisplayName({ isDevelopment: true, platform: "darwin" })).toBe(
      "T3 Code (Dev)",
    );
  });

  it("keeps the existing non-mac production name", () => {
    expect(getDesktopAppDisplayName({ isDevelopment: false, platform: "linux" })).toBe(
      "T3 Code (Alpha)",
    );
    expect(getDesktopAppDisplayName({ isDevelopment: false, platform: "win32" })).toBe(
      "T3 Code (Alpha)",
    );
  });
});
