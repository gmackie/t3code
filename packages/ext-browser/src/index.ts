/**
 * Browser panel — full in-app browser with tab management.
 *
 * Provides panel metadata constants. The full UI component lives in the
 * web app since it wraps BrowserPanel.tsx and depends on browserStateStore,
 * BrowserManager IPC, and viewport synchronization — all app-internal modules.
 *
 * This package exports the portable parts: panel identity and metadata.
 * When the browser panel moves to its own repo, this package will contain
 * the full BrowserPanel component with browser APIs injected via context.
 */

export const BROWSER_PANEL_ID = "browser";
export const BROWSER_PANEL_TITLE = "Browser";
export const BROWSER_PANEL_ORDER = 20;
