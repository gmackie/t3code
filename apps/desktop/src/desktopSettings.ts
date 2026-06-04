import * as FS from "node:fs";
import * as Path from "node:path";
import type { DesktopServerExposureMode, DesktopUpdateChannel } from "@t3tools/contracts";

import { resolveDefaultDesktopUpdateChannel } from "./updateChannels";

export interface DesktopSettings {
  readonly serverExposureMode: DesktopServerExposureMode;
  readonly updateChannel: DesktopUpdateChannel;
}

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  serverExposureMode: "local-only",
  updateChannel: "latest",
};

export function resolveDefaultDesktopSettings(appVersion: string): DesktopSettings {
  return {
    ...DEFAULT_DESKTOP_SETTINGS,
    updateChannel: resolveDefaultDesktopUpdateChannel(appVersion),
  };
}

export function setDesktopServerExposurePreference(
  settings: DesktopSettings,
  requestedMode: DesktopServerExposureMode,
): DesktopSettings {
  return settings.serverExposureMode === requestedMode
    ? settings
    : {
        ...settings,
        serverExposureMode: requestedMode,
      };
}

export function setDesktopUpdateChannelPreference(
  settings: DesktopSettings,
  requestedChannel: DesktopUpdateChannel,
): DesktopSettings {
  return settings.updateChannel === requestedChannel
    ? settings
    : {
        ...settings,
        updateChannel: requestedChannel,
      };
}

export function readDesktopSettings(settingsPath: string, appVersion = "0.0.0"): DesktopSettings {
  const defaultSettings = resolveDefaultDesktopSettings(appVersion);
  try {
    if (!FS.existsSync(settingsPath)) {
      return defaultSettings;
    }

    const raw = FS.readFileSync(settingsPath, "utf8");
    const parsed = JSON.parse(raw) as {
      readonly serverExposureMode?: unknown;
      readonly updateChannel?: unknown;
    };

    return {
      serverExposureMode:
        parsed.serverExposureMode === "network-accessible" ? "network-accessible" : "local-only",
      updateChannel:
        parsed.updateChannel === "nightly" || parsed.updateChannel === "gmacko"
          ? parsed.updateChannel
          : defaultSettings.updateChannel,
    };
  } catch {
    return defaultSettings;
  }
}

export function writeDesktopSettings(settingsPath: string, settings: DesktopSettings): void {
  const directory = Path.dirname(settingsPath);
  const tempPath = `${settingsPath}.${process.pid}.${Date.now()}.tmp`;
  FS.mkdirSync(directory, { recursive: true });
  FS.writeFileSync(tempPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  FS.renameSync(tempPath, settingsPath);
}
