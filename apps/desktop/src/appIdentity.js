const DEFAULT_APP_ID = "com.t3tools.t3code";
const GMACKO_APP_ID = "com.t3tools.t3code.gmacko";
const DEFAULT_UPDATER_CACHE_DIR_NAME = "t3code-updater";
const GMACKO_UPDATER_CACHE_DIR_NAME = "t3code-gmacko-updater";
const DEFAULT_PACKAGE_NAME = "t3code";
const GMACKO_PACKAGE_NAME = "t3code-gmacko";
const DEFAULT_USER_DATA_DIR_NAME = "t3code";
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
 *   displayName: string;
 *   packageName: string;
 *   stateDirName: string;
 *   updaterCacheDirName: string;
 *   userDataDirName: string;
 * }}
 */
export function getDesktopRuntimeIdentity(input) {
  if (input.isDevelopment) {
    return {
      appId: DEFAULT_APP_ID,
      appUserModelId: DEFAULT_APP_ID,
      displayName: "T3 Code (Dev)",
      packageName: DEFAULT_PACKAGE_NAME,
      stateDirName: DEV_STATE_DIR_NAME,
      updaterCacheDirName: DEFAULT_UPDATER_CACHE_DIR_NAME,
      userDataDirName: DEV_USER_DATA_DIR_NAME,
    };
  }

  if (
    isGmackoDesktopAppDisplayName(input.appDisplayName) ||
    isGmackoDesktopPackageName(input.packageName) ||
    isGmackoDesktopAppId(input.appId)
  ) {
    return {
      appId: GMACKO_APP_ID,
      appUserModelId: GMACKO_APP_ID,
      displayName: GMACKO_APP_DISPLAY_NAME,
      packageName: GMACKO_PACKAGE_NAME,
      stateDirName: GMACKO_STATE_DIR_NAME,
      updaterCacheDirName: GMACKO_UPDATER_CACHE_DIR_NAME,
      userDataDirName: DEFAULT_USER_DATA_DIR_NAME,
    };
  }

  return {
    appId: DEFAULT_APP_ID,
    appUserModelId: DEFAULT_APP_ID,
    displayName: DEFAULT_APP_DISPLAY_NAME,
    packageName: DEFAULT_PACKAGE_NAME,
    stateDirName: DEFAULT_STATE_DIR_NAME,
    updaterCacheDirName: DEFAULT_UPDATER_CACHE_DIR_NAME,
    userDataDirName: DEFAULT_USER_DATA_DIR_NAME,
  };
}
