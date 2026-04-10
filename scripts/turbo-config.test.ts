import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("turbo env propagation", () => {
  it("includes the desktop app display name override in globalEnv", () => {
    const turboConfigPath = resolve(import.meta.dirname, "../turbo.json");
    const turboConfig = JSON.parse(readFileSync(turboConfigPath, "utf8")) as {
      globalEnv?: string[];
    };

    expect(turboConfig.globalEnv).toContain("T3CODE_DESKTOP_APP_DISPLAY_NAME");
  });
});
