import type { DesktopUpdateChannel } from "@t3tools/contracts";

const NIGHTLY_VERSION_PATTERN = /-nightly\.\d{8}\.\d+$/;
const GMACKO_VERSION_PATTERN = /-gmacko\.\d+$/;

export function isNightlyDesktopVersion(version: string): boolean {
  return NIGHTLY_VERSION_PATTERN.test(version);
}

export function isGmackoDesktopVersion(version: string): boolean {
  return GMACKO_VERSION_PATTERN.test(version);
}

export function resolveDefaultDesktopUpdateChannel(appVersion: string): DesktopUpdateChannel {
  if (isNightlyDesktopVersion(appVersion)) {
    return "nightly";
  }
  if (isGmackoDesktopVersion(appVersion)) {
    return "gmacko";
  }
  return "latest";
}

export function doesVersionMatchDesktopUpdateChannel(
  version: string,
  channel: DesktopUpdateChannel,
): boolean {
  return resolveDefaultDesktopUpdateChannel(version) === channel;
}

export function getAutoUpdaterChannelConfig(channel: DesktopUpdateChannel): {
  allowPrerelease: boolean;
  allowDowngrade: boolean;
} {
  return {
    allowPrerelease: channel !== "latest",
    allowDowngrade: false,
  };
}
