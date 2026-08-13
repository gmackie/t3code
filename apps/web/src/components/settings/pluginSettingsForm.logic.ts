import {
  defaultPluginSettings,
  type PluginSettingContribution,
  type PluginSettingValueMap,
  validatePluginSettings,
} from "@t3tools/contracts";

export function getPluginSettingsDraft(
  contributions: readonly PluginSettingContribution[],
  values: PluginSettingValueMap,
): PluginSettingValueMap {
  return { ...defaultPluginSettings(contributions), ...values };
}

export function validatePluginSettingsDraft(
  contributions: readonly PluginSettingContribution[],
  values: PluginSettingValueMap,
): string | null {
  try {
    validatePluginSettings(contributions, values);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid plugin setting";
  }
}
