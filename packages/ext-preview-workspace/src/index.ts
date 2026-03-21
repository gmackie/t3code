/**
 * Preview Workspace panel — project-aware development preview.
 *
 * Provides URL management utilities and the panel definition metadata.
 * The full UI component lives in the web app since it depends on
 * app-specific modules (browserStateStore, BrowserPanel, readNativeApi).
 *
 * This package exports the portable parts: URL persistence helpers,
 * cleanup logic, and panel metadata constants.
 */

export const PREVIEW_WORKSPACE_PANEL_ID = "preview-workspace";
export const PREVIEW_WORKSPACE_PANEL_TITLE = "Preview";
export const PREVIEW_WORKSPACE_PANEL_ORDER = 10;

export const DEFAULT_PREVIEW_URL = "http://localhost:3000";
export const PREVIEW_URL_STORAGE_PREFIX = "t3code:preview-url:";

export function getPersistedPreviewUrl(threadId: string): string {
  try {
    return localStorage.getItem(`${PREVIEW_URL_STORAGE_PREFIX}${threadId}`) ?? DEFAULT_PREVIEW_URL;
  } catch {
    return DEFAULT_PREVIEW_URL;
  }
}

export function persistPreviewUrl(threadId: string, url: string): void {
  try {
    localStorage.setItem(`${PREVIEW_URL_STORAGE_PREFIX}${threadId}`, url);
  } catch {
    // localStorage unavailable
  }
}

export function removeOrphanedPreviewUrls(activeThreadIds: Set<string>): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key?.startsWith(PREVIEW_URL_STORAGE_PREFIX)) continue;
      const threadId = key.slice(PREVIEW_URL_STORAGE_PREFIX.length);
      if (!activeThreadIds.has(threadId)) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // localStorage unavailable
  }
}
