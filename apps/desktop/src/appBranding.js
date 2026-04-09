/**
 * @typedef {"mac" | "darwin" | "linux" | "win" | "win32"} DesktopBrandingPlatform
 */

const DEV_APP_DISPLAY_NAME = "T3 Code (Dev)";
const MAC_PRODUCTION_APP_DISPLAY_NAME = "T3 Code (gmacko)";
const DEFAULT_PRODUCTION_APP_DISPLAY_NAME = "T3 Code (Alpha)";

/**
 * @param {DesktopBrandingPlatform | string} platform
 * @returns {boolean}
 */
function isMacDesktopPlatform(platform) {
  return platform === "mac" || platform === "darwin";
}

/**
 * @param {{ isDevelopment: boolean; platform: DesktopBrandingPlatform | string }} input
 * @returns {string}
 */
export function getDesktopAppDisplayName(input) {
  if (input.isDevelopment) {
    return DEV_APP_DISPLAY_NAME;
  }

  return isMacDesktopPlatform(input.platform)
    ? MAC_PRODUCTION_APP_DISPLAY_NAME
    : DEFAULT_PRODUCTION_APP_DISPLAY_NAME;
}
