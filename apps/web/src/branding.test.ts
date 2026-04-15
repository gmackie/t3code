import { describe, expect, it } from "vitest";

import { resolveAppDisplayName, resolveAppStageLabel } from "./branding";

describe("resolveAppStageLabel", () => {
  it("uses GMACKO for packaged production builds", () => {
    expect(resolveAppStageLabel({ isDevelopment: false })).toBe("GMACKO");
  });

  it("keeps the dev label during development", () => {
    expect(resolveAppStageLabel({ isDevelopment: true })).toBe("Dev");
  });
});

describe("resolveAppDisplayName", () => {
  it("includes the resolved stage label in the app display name", () => {
    expect(resolveAppDisplayName({ isDevelopment: false })).toBe("T3 Code (GMACKO)");
  });
});
