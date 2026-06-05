import { describe, expect, it } from "vite-plus/test";

import { SETTINGS_NAV_ITEM_DEFINITIONS } from "./SettingsSidebarNav.logic";

describe("SETTINGS_NAV_ITEM_DEFINITIONS", () => {
  it("includes the Issues settings section", () => {
    expect(SETTINGS_NAV_ITEM_DEFINITIONS).toContainEqual(
      expect.objectContaining({
        label: "Issues",
        to: "/settings/issues",
      }),
    );
  });
});
