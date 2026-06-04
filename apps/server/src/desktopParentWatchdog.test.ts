import { describe, expect, it } from "vitest";

import { shouldDesktopParentWatchdogStop } from "./desktopParentWatchdog.ts";

describe("desktopParentWatchdog", () => {
  it("stops desktop backends once the original parent is gone", () => {
    expect(
      shouldDesktopParentWatchdogStop({
        mode: "desktop",
        initialParentPid: 4321,
        currentParentPid: 1,
        isInitialParentAlive: false,
      }),
    ).toBe(true);
  });

  it("keeps running while the desktop parent is still alive", () => {
    expect(
      shouldDesktopParentWatchdogStop({
        mode: "desktop",
        initialParentPid: 4321,
        currentParentPid: 4321,
        isInitialParentAlive: true,
      }),
    ).toBe(false);
  });

  it("does nothing outside desktop mode", () => {
    expect(
      shouldDesktopParentWatchdogStop({
        mode: "web",
        initialParentPid: 4321,
        currentParentPid: 1,
        isInitialParentAlive: false,
      }),
    ).toBe(false);
  });
});
