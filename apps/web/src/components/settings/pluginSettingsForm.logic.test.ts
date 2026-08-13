import { describe, expect, it } from "vite-plus/test";

import type { PluginSettingContribution } from "@t3tools/contracts";
import { getPluginSettingsDraft, validatePluginSettingsDraft } from "./pluginSettingsForm.logic.ts";

const settings: readonly PluginSettingContribution[] = [
  { id: "name", title: "Name", scope: "server", field: { kind: "text", default: "T3" } },
  { id: "enabled", title: "Enabled", scope: "server", field: { kind: "boolean", default: true } },
];

describe("plugin settings form logic", () => {
  it("fills missing values from plugin-declared defaults", () => {
    expect(getPluginSettingsDraft(settings, { name: "Custom" })).toEqual({ name: "Custom", enabled: true });
  });

  it("returns a field error without throwing on invalid draft values", () => {
    expect(validatePluginSettingsDraft(settings, { name: 42, enabled: true })).toEqual(
      "expected string for name",
    );
    expect(validatePluginSettingsDraft(settings, { name: "ok", enabled: true })).toBeNull();
  });
});
