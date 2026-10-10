import { useEffect, useRef } from "react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { consumePreviewRevealRequest, type ThreadPreviewState } from "~/previewStateStore";
import { browserMiniPlayerSource, usePreviewMiniPlayerStore } from "~/previewMiniPlayerStore";
import { type RightPanelSurface, useRightPanelStore } from "~/rightPanelStore";

export function useServerPreviewReveal(
  threadRef: ScopedThreadRef | null,
  serverBrowser: boolean,
  previewState: ThreadPreviewState,
  autoShowFloatingPreview: boolean,
  surfaces: readonly RightPanelSurface[],
): void {
  // Baseline loaded tabs so reloads never reopen previews the user dismissed.
  const previousServerPreviewTabs = useRef(new Map<string, Map<string, string | undefined>>());
  useEffect(() => {
    if (!threadRef || !serverBrowser || !previewState.listLoaded) return;
    const threadKey = scopedThreadKey(threadRef);
    const serverSessions = Object.values(previewState.sessions).filter(
      (session) => session.runtime === "server",
    );
    const previous = previousServerPreviewTabs.current.get(threadKey);
    previousServerPreviewTabs.current.set(
      threadKey,
      new Map(serverSessions.map((session) => [session.tabId, session.revealRequest?.id])),
    );
    for (const session of serverSessions) {
      const requested = session.revealRequest;
      const pending =
        requested && previewState.pendingRevealRequests[session.tabId] === requested.id;
      const fresh = pending
        ? consumePreviewRevealRequest(threadRef, session.tabId, requested.id)
        : previous &&
          (requested ? previous.get(session.tabId) !== requested.id : !previous.has(session.tabId));
      if (!fresh || session.reveal !== true) continue;
      if (!autoShowFloatingPreview && requested?.force !== true) continue;
      const surface = surfaces.find(
        (surface) => surface.kind === "preview" && surface.resourceId === session.tabId,
      );
      if (surface && requested?.force === true) {
        useRightPanelStore.getState().activateSurface(threadRef, surface.id);
      } else if (!surface) {
        usePreviewMiniPlayerStore
          .getState()
          .open(threadRef, browserMiniPlayerSource(session.tabId));
      }
    }
  }, [
    serverBrowser,
    previewState.listLoaded,
    previewState.pendingRevealRequests,
    previewState.sessions,
    threadRef,
    autoShowFloatingPreview,
    surfaces,
  ]);
}
