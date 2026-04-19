/**
 * Browser extension — wraps PR #963's BrowserPanel as a PanelDefinition.
 *
 * This demonstrates how the in-app browser can be a pluggable extension
 * rather than hardcoded into the chat route layout. The BrowserPanel UI
 * component is unchanged — this extension connects it to the extension host
 * context and the browser state store.
 *
 * Requires: apps/web/src/browser.ts, browserStateStore.ts, components/BrowserPanel.tsx
 * from the in-app browser PR (#963).
 *
 * DATA FLOW:
 *
 *   PanelHost
 *   ├── context.activeThreadId ──→ browserStateStore key
 *   ├── browserStateStore ──→ BrowserPanel props (tabs, activeTab, input)
 *   └── NativeApi.browser.* ──→ BrowserManager (Electron)
 *       └── onBrowserEvent ──→ browserStateStore updates ──→ re-render
 */

import { useCallback, useEffect, useMemo, useRef } from "react";

import {
  createBrowserTab,
  normalizeBrowserDisplayUrl,
  parseSubmittedBrowserUrl,
} from "../../browser";
import { selectThreadBrowserState, useBrowserStateStore } from "../../browserStateStore";
import BrowserPanel from "../../components/BrowserPanel";
import { readNativeApi } from "../../nativeApi";
import type { PanelDefinition } from "../types";

export const browserExtension: PanelDefinition = {
  id: "browser",
  title: "Browser",
  surface: "thread.sidePanel",
  order: 20,
  isAvailable: (_context) => _context.threadView !== null,
  render: (context) => <BrowserExtensionPanel context={context} />,
};

function BrowserExtensionPanel({ context }: { context: Parameters<PanelDefinition["render"]>[0] }) {
  const threadId = context.activeThreadId;
  const browserState = useBrowserStateStore((s) =>
    threadId ? selectThreadBrowserState(s.browserStateByThreadId, threadId) : null,
  );
  const updateBrowserState = useBrowserStateStore((s) => s.updateThreadBrowserState);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const activeTab = useMemo(() => {
    if (!browserState?.activeTabId || !browserState.tabs) return null;
    return browserState.tabs.find((tab) => tab.id === browserState.activeTabId) ?? null;
  }, [browserState?.activeTabId, browserState?.tabs]);

  // Sync browser host bounds when viewport changes
  useEffect(() => {
    if (!threadId || !viewportRef.current) return;
    const api = readNativeApi();
    if (!api?.browser) return;

    const el = viewportRef.current;
    let rafId: number | null = null;
    const syncBounds = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        const rect = el.getBoundingClientRect();
        void api.browser.syncHost({
          threadId,
          tabId: browserState?.activeTabId ?? null,
          visible: true,
          bounds: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
        });
      });
    };

    const observer = new ResizeObserver(syncBounds);
    observer.observe(el);
    syncBounds();

    return () => {
      observer.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
      void api.browser.syncHost({
        threadId,
        tabId: null,
        visible: false,
        bounds: { x: 0, y: 0, width: 0, height: 0 },
      });
    };
  }, [threadId, browserState?.activeTabId]);

  // Subscribe to browser events from Electron, scoped to current thread
  useEffect(() => {
    if (!threadId) return;
    const api = readNativeApi();
    if (!api?.browser) return;

    const unsub = api.browser.onEvent((event) => {
      if (event.type !== "tab-state" || event.threadId !== threadId) return;
      updateBrowserState(threadId, (draft) => ({
        ...draft,
        tabs: draft.tabs.map((tab): typeof tab =>
          tab.id === event.tabId
            ? {
                ...tab,
                url: event.state.url,
                title: event.state.title,
                faviconUrl: event.state.faviconUrl,
                isLoading: event.state.isLoading,
                canGoBack: event.state.canGoBack,
                canGoForward: event.state.canGoForward,
                lastError: event.state.lastError,
              }
            : tab,
        ),
      }));
    });

    return unsub;
  }, [threadId, updateBrowserState]);

  const handleCreateTab = useCallback(() => {
    if (!threadId) return;
    const tab = createBrowserTab();
    updateBrowserState(threadId, (draft) => ({
      ...draft,
      tabs: [...draft.tabs, tab],
      activeTabId: tab.id,
      inputValue: "",
      focusRequestId: draft.focusRequestId + 1,
    }));

    const api = readNativeApi();
    if (api?.browser) {
      void api.browser.ensureTab({ threadId, tabId: tab.id });
    }
  }, [threadId, updateBrowserState]);

  const handleActivateTab = useCallback(
    (tabId: string) => {
      if (!threadId) return;
      updateBrowserState(threadId, (draft) => {
        const tab = draft.tabs.find((t) => t.id === tabId);
        return {
          ...draft,
          activeTabId: tabId,
          inputValue: normalizeBrowserDisplayUrl(tab?.url),
        };
      });
    },
    [threadId, updateBrowserState],
  );

  const handleCloseTab = useCallback(
    (tabId: string) => {
      if (!threadId) return;
      const api = readNativeApi();
      if (api?.browser) {
        void api.browser.closeTab({ threadId, tabId });
      }
      updateBrowserState(threadId, (draft) => {
        const nextTabs = draft.tabs.filter((t) => t.id !== tabId);
        const wasActive = draft.activeTabId === tabId;
        return {
          ...draft,
          tabs: nextTabs,
          activeTabId: wasActive ? (nextTabs[nextTabs.length - 1]?.id ?? null) : draft.activeTabId,
          inputValue: wasActive
            ? normalizeBrowserDisplayUrl(nextTabs[nextTabs.length - 1]?.url)
            : draft.inputValue,
        };
      });
    },
    [threadId, updateBrowserState],
  );

  const handleSubmit = useCallback(() => {
    if (!threadId || !browserState) return;
    const result = parseSubmittedBrowserUrl(browserState.inputValue);
    if (!result.ok) return;

    let tabId = browserState.activeTabId;
    if (!tabId) {
      const tab = createBrowserTab(result.url);
      tabId = tab.id;
      updateBrowserState(threadId, (draft) => ({
        ...draft,
        tabs: [...draft.tabs, tab],
        activeTabId: tab.id,
        inputValue: normalizeBrowserDisplayUrl(result.url),
      }));
    } else {
      updateBrowserState(threadId, (draft) => ({
        ...draft,
        tabs: draft.tabs.map((t) => (t.id === tabId ? { ...t, url: result.url } : t)),
        inputValue: normalizeBrowserDisplayUrl(result.url),
      }));
    }

    const api = readNativeApi();
    if (api?.browser) {
      void api.browser.navigate({ threadId, tabId: tabId!, url: result.url });
    }
  }, [threadId, browserState, updateBrowserState]);

  const handleBack = useCallback(() => {
    if (!threadId || !browserState?.activeTabId) return;
    const api = readNativeApi();
    if (api?.browser) {
      void api.browser.goBack({ threadId, tabId: browserState.activeTabId });
    }
  }, [threadId, browserState?.activeTabId]);

  const handleForward = useCallback(() => {
    if (!threadId || !browserState?.activeTabId) return;
    const api = readNativeApi();
    if (api?.browser) {
      void api.browser.goForward({ threadId, tabId: browserState.activeTabId });
    }
  }, [threadId, browserState?.activeTabId]);

  const handleReload = useCallback(() => {
    if (!threadId || !browserState?.activeTabId) return;
    const api = readNativeApi();
    if (api?.browser) {
      void api.browser.reload({ threadId, tabId: browserState.activeTabId });
    }
  }, [threadId, browserState?.activeTabId]);

  const handleOpenExternal = useCallback(() => {
    if (!activeTab?.url || activeTab.url === "about:blank") return;
    const api = readNativeApi();
    if (api?.shell) {
      void api.shell.openExternal(activeTab.url);
    }
  }, [activeTab?.url]);

  const handleInputChange = useCallback(
    (value: string) => {
      if (!threadId) return;
      updateBrowserState(threadId, (draft) => ({
        ...draft,
        inputValue: value,
      }));
    },
    [threadId, updateBrowserState],
  );

  const handleViewportRef = useCallback((el: HTMLDivElement | null) => {
    viewportRef.current = el;
  }, []);

  if (!threadId || !browserState) return null;

  return (
    <BrowserPanel
      state={browserState}
      activeTab={activeTab}
      inputValue={browserState.inputValue}
      focusRequestId={browserState.focusRequestId}
      onInputChange={handleInputChange}
      onCreateTab={handleCreateTab}
      onActivateTab={handleActivateTab}
      onCloseTab={handleCloseTab}
      onSubmit={handleSubmit}
      onBack={handleBack}
      onForward={handleForward}
      onReload={handleReload}
      onOpenExternal={handleOpenExternal}
      viewportRef={handleViewportRef}
    />
  );
}
