/**
 * Preview Workspace extension metadata.
 *
 * The full UI component lives in the web app (it depends on app-specific
 * components like BrowserPanel, browserStateStore, etc.). This package
 * exports the extension ID and metadata so external tooling can reference it.
 *
 * When extensions become separate repos, this package will contain the full
 * implementation with the browser APIs injected via the extension context.
 */

export const PREVIEW_WORKSPACE_EXTENSION_ID = "preview-workspace";
export const PREVIEW_WORKSPACE_EXTENSION_TITLE = "Preview";
export const PREVIEW_WORKSPACE_EXTENSION_ORDER = 10;
