/**
 * Preview Workspace extension — project-aware development preview.
 *
 * Unlike the general browser extension, the preview workspace is focused on
 * the active project's dev server. It:
 * - Pre-fills the URL from project context (defaults to localhost:3000)
 * - Shows project scripts as context (display-only for now)
 * - Persists the preview URL per thread
 * - Provides a focused "open preview" experience
 *
 * In desktop mode, it opens the preview in the browser extension's managed
 * BrowserWindow. In browser mode, it opens in a new tab.
 */

import { useCallback, useMemo, useState } from "react";

import { isElectron } from "../../env";
import { readNativeApi } from "../../nativeApi";
import { createBrowserTab, parseSubmittedBrowserUrl } from "../../browser";
import { useBrowserStateStore } from "../../browserStateStore";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { ScrollArea } from "../../components/ui/scroll-area";
import {
  ExternalLinkIcon,
  GlobeIcon,
  PlayIcon,
  RefreshCwIcon,
} from "lucide-react";
import type { T3ExtensionDefinition } from "../types";

const DEFAULT_PREVIEW_URL = "http://localhost:3000";
const PREVIEW_URL_STORAGE_PREFIX = "t3code:preview-url:";

function getPersistedPreviewUrl(threadId: string): string {
  try {
    return localStorage.getItem(`${PREVIEW_URL_STORAGE_PREFIX}${threadId}`) ?? DEFAULT_PREVIEW_URL;
  } catch {
    return DEFAULT_PREVIEW_URL;
  }
}

function persistPreviewUrl(threadId: string, url: string): void {
  try {
    localStorage.setItem(`${PREVIEW_URL_STORAGE_PREFIX}${threadId}`, url);
  } catch {
    // localStorage unavailable
  }
}

export const previewWorkspaceExtension: T3ExtensionDefinition = {
  id: "preview-workspace",
  title: "Preview",
  surface: "thread.sidePanel",
  order: 10,
  isAvailable: (context) => context.threadView?.project !== null && context.threadView !== null,
  render: (context) => <PreviewWorkspacePanel context={context} />,
};

function PreviewWorkspacePanel({
  context,
}: {
  context: Parameters<T3ExtensionDefinition["render"]>[0];
}) {
  const threadView = context.threadView;
  const threadId = context.activeThreadId;
  const updateBrowserState = useBrowserStateStore((s) => s.updateThreadBrowserState);

  const [previewUrl, setPreviewUrl] = useState(() =>
    threadId ? getPersistedPreviewUrl(threadId) : DEFAULT_PREVIEW_URL,
  );
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const scripts = useMemo(() => threadView?.project?.scripts ?? [], [threadView?.project?.scripts]);
  const devScripts = useMemo(
    () => scripts.filter((s) => s.icon === "play" || s.icon === "debug"),
    [scripts],
  );

  const handleUrlChange = useCallback(
    (value: string) => {
      setPreviewUrl(value);
      if (threadId) {
        persistPreviewUrl(threadId, value);
      }
    },
    [threadId],
  );

  const handleOpenPreview = useCallback(() => {
    if (!threadId) return;
    const result = parseSubmittedBrowserUrl(previewUrl);
    if (!result.ok) return;

    const api = readNativeApi();

    if (isElectron && api?.browser) {
      // Desktop mode: open in the managed browser via BrowserManager
      const tab = createBrowserTab(result.url);
      updateBrowserState(threadId, (draft) => ({
        ...draft,
        tabs: [...draft.tabs, tab],
        activeTabId: tab.id,
        inputValue: result.url,
      }));
      void api.browser.ensureTab({ threadId, tabId: tab.id, url: result.url });
      void api.browser.navigate({ threadId, tabId: tab.id, url: result.url });
      setIsPreviewOpen(true);
    } else if (api?.shell) {
      // Browser mode: open in new tab
      void api.shell.openExternal(result.url);
    }
  }, [threadId, previewUrl, updateBrowserState]);

  const handleReload = useCallback(() => {
    if (!threadId) return;
    const api = readNativeApi();
    const state = useBrowserStateStore.getState();
    const threadState = state.browserStateByThreadId[threadId];
    if (api?.browser && threadState?.activeTabId) {
      void api.browser.reload({ threadId, tabId: threadState.activeTabId });
    }
  }, [threadId]);

  const handleOpenExternal = useCallback(() => {
    const result = parseSubmittedBrowserUrl(previewUrl);
    if (!result.ok) return;
    const api = readNativeApi();
    if (api?.shell) {
      void api.shell.openExternal(result.url);
    }
  }, [previewUrl]);

  if (!threadView || !threadId) return null;

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-4 p-3">
        {/* Header */}
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {threadView.project?.cwd?.split("/").pop() ?? "Preview"}
              </p>
              <p className="text-xs text-muted-foreground">Development preview</p>
            </div>
            {isPreviewOpen ? (
              <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-500">
                Live
              </Badge>
            ) : null}
          </div>
        </section>

        {/* URL Input */}
        <section className="space-y-2">
          <p className="text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase">
            Preview URL
          </p>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              handleOpenPreview();
            }}
          >
            <Input
              value={previewUrl}
              onChange={(e) => handleUrlChange(e.target.value)}
              placeholder="http://localhost:3000"
              className="font-mono text-xs"
              autoFocus
            />
          </form>

          <div className="flex flex-wrap gap-2">
            <Button size="xs" variant="default" onClick={handleOpenPreview}>
              <PlayIcon className="mr-1 size-3" />
              {isElectron ? "Open Preview" : "Open in New Tab"}
            </Button>
            {isPreviewOpen ? (
              <Button size="xs" variant="outline" onClick={handleReload}>
                <RefreshCwIcon className="mr-1 size-3" />
                Reload
              </Button>
            ) : null}
            <Button size="xs" variant="ghost" onClick={handleOpenExternal}>
              <ExternalLinkIcon className="mr-1 size-3" />
              External
            </Button>
          </div>
        </section>

        {/* Project Scripts */}
        {scripts.length > 0 ? (
          <section className="space-y-2">
            <p className="text-[10px] font-semibold tracking-widest text-muted-foreground/40 uppercase">
              Project Scripts
            </p>
            <div className="flex flex-wrap gap-2">
              {scripts.map((script) => (
                <Badge
                  key={script.id}
                  variant="secondary"
                  className="cursor-default text-xs"
                  title={script.command}
                >
                  {devScripts.includes(script) ? (
                    <PlayIcon className="mr-1 size-3 text-emerald-500" />
                  ) : (
                    <GlobeIcon className="mr-1 size-3" />
                  )}
                  {script.name}
                </Badge>
              ))}
            </div>
          </section>
        ) : null}

        {/* Info */}
        {!isElectron ? (
          <div className="rounded-lg border border-dashed border-border/60 bg-background/30 p-3 text-xs text-muted-foreground">
            Desktop app required for inline preview. Previews open in a new browser tab instead.
          </div>
        ) : null}
      </div>
    </ScrollArea>
  );
}
