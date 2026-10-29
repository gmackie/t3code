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
