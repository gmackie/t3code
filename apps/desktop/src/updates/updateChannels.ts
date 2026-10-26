import type { DesktopUpdateChannel } from "@t3tools/contracts";

const NIGHTLY_VERSION_PATTERN = /^[^-+]+-nightly\.\d{8}\.\d+$/;
// Preview builds share nightly branding but ship without an update feed.
const PRERELEASE_VERSION_PATTERN = /^[^-+]+-(?:nightly|preview)\.\d{8}\.\d+$/;
// GMACKO fork releases (0.0.45-gmacko.202610022125) follow their own channel.
const GMACKO_VERSION_PATTERN = /-gmacko\.\d+$/;

export function isNightlyDesktopVersion(version: string): boolean {
  return PRERELEASE_VERSION_PATTERN.test(version);
}

export function isGmackoDesktopVersion(version: string): boolean {
  return GMACKO_VERSION_PATTERN.test(version);
}

export function resolveDefaultDesktopUpdateChannel(appVersion: string): DesktopUpdateChannel {
  if (NIGHTLY_VERSION_PATTERN.test(appVersion)) return "nightly";
  if (isGmackoDesktopVersion(appVersion)) return "gmacko";
  return "latest";
}
