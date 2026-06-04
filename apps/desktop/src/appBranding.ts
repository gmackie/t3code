import type { DesktopAppBranding, DesktopAppStageLabel } from "@t3tools/contracts";

import { isGmackoDesktopVersion, isNightlyDesktopVersion } from "./updateChannels.ts";

const APP_BASE_NAME = "T3 Code";

export function resolveDesktopAppStageLabel(input: {
  readonly isDevelopment: boolean;
  readonly appVersion: string;
}): DesktopAppStageLabel {
  if (input.isDevelopment) {
    return "Dev";
  }

  if (isNightlyDesktopVersion(input.appVersion)) {
    return "Nightly";
  }
  if (isGmackoDesktopVersion(input.appVersion)) {
    return "Gmacko";
  }
  return "Alpha";
}

export function resolveDesktopAppBranding(input: {
  readonly isDevelopment: boolean;
  readonly appVersion: string;
}): DesktopAppBranding {
  const stageLabel = resolveDesktopAppStageLabel(input);
  return {
    baseName: APP_BASE_NAME,
    stageLabel,
    displayName: `${APP_BASE_NAME} (${stageLabel})`,
  };
}
