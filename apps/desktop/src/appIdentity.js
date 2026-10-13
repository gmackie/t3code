const DEFAULT_APP_ID = "com.t3tools.t3code";
const GMACKO_APP_ID = "com.gmacko.t3code";
const DEFAULT_UPDATER_CACHE_DIR_NAME = "t3code-updater";
const GMACKO_UPDATER_CACHE_DIR_NAME = "t3code-gmacko-updater";
const DEFAULT_PACKAGE_NAME = "t3code";
const GMACKO_PACKAGE_NAME = "t3code-gmacko";
const DEFAULT_BASE_DIR_NAME = ".t3";
const GMACKO_BASE_DIR_NAME = ".t3-gmacko";
const DEFAULT_USER_DATA_DIR_NAME = "t3code";
const GMACKO_USER_DATA_DIR_NAME = "t3code-gmacko";
const DEV_USER_DATA_DIR_NAME = "t3code-dev";
const DEFAULT_STATE_DIR_NAME = "userdata";
const GMACKO_STATE_DIR_NAME = "userdata-gmacko";
const DEV_STATE_DIR_NAME = "userdata-dev";
const GMACKO_APP_DISPLAY_NAME = "T3 Code (gmacko)";
const DEFAULT_APP_DISPLAY_NAME = "T3 Code (Alpha)";

/**
 * @param {string | undefined | null} value
 * @returns {string}
 */
function normalizeAppDisplayName(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {string | undefined | null} appDisplayName
 * @returns {boolean}
 */
export function isGmackoDesktopAppDisplayName(appDisplayName) {
  return normalizeAppDisplayName(appDisplayName) === GMACKO_APP_DISPLAY_NAME;
}

/**
 * @param {string | undefined | null} packageName
 * @returns {boolean}
 */
export function isGmackoDesktopPackageName(packageName) {
  return normalizeAppDisplayName(packageName) === GMACKO_PACKAGE_NAME;
}

/**
 * @param {string | undefined | null} appId
 * @returns {boolean}
 */
export function isGmackoDesktopAppId(appId) {
  return normalizeAppDisplayName(appId) === GMACKO_APP_ID;
}

/**
 * @param {{
 *   isDevelopment: boolean;
 *   appDisplayName: string | undefined | null;
 *   packageName?: string | undefined | null;
 *   appId?: string | undefined | null;
 * }} input
 * @returns {{
 *   appId: string;
 *   appUserModelId: string;
 *   baseDirName: string;
 *   displayName: string;
 *   packageName: string;
 *   stateDirName: string;
 *   updaterCacheDirName: string;
 *   userDataDirName: string;
 * }}
 */
export function getDesktopRuntimeIdentity(input) {
  return {
    appId: "com.t3tools.t3code.locked",
    appUserModelId: "com.t3tools.t3code.locked",
    baseDirName: ".t3-locked",
    displayName: input.isDevelopment ? "T3 Code Locked (Dev)" : "T3 Code Locked",
    packageName: "t3code-locked",
    stateDirName: input.isDevelopment ? "userdata-dev" : "userdata",
    updaterCacheDirName: "t3code-locked-updater",
    userDataDirName: input.isDevelopment ? "t3code-locked-dev" : "t3code-locked",
  };
}
