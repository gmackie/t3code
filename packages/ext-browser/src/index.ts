/**
 * Browser extension metadata.
 *
 * The full UI component lives in the web app (wraps BrowserPanel from PR #963).
 * This package exports the extension ID and metadata.
 *
 * When extensions become separate repos, this package will contain the full
 * BrowserPanel implementation with browser APIs injected via the context.
 */

export const BROWSER_EXTENSION_ID = "browser";
export const BROWSER_EXTENSION_TITLE = "Browser";
export const BROWSER_EXTENSION_ORDER = 20;
