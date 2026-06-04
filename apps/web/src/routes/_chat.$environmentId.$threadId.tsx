import { createFileRoute, retainSearchParams, useNavigate } from "@tanstack/react-router";
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";

import ChatView from "../components/ChatView";
import { threadHasStarted } from "../components/ChatView.logic";
import { DiffWorkerPoolProvider } from "../components/DiffWorkerPoolProvider";
import {
  DiffPanelHeaderSkeleton,
  DiffPanelLoadingState,
  DiffPanelShell,
  type DiffPanelMode,
} from "../components/DiffPanelShell";
import { finalizePromotedDraftThreadByRef, useComposerDraftStore } from "../composerDraftStore";
import {
  type DiffRouteSearch,
  parseDiffRouteSearch,
  stripDiffSearchParams,
} from "../diffRouteSearch";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "../rightPanelLayout";
import { selectEnvironmentState, selectThreadExistsByRef, useStore } from "../store";
import { createThreadSelectorByRef } from "../storeSelectors";
import { resolveThreadRouteRef, buildThreadRouteParams } from "../threadRoutes";
import { RightPanelSheet } from "../components/RightPanelSheet";
import { Sidebar, SidebarInset, SidebarProvider, SidebarRail } from "~/components/ui/sidebar";
import { useBrowserStateStore } from "../browserStateStore";
import { BROWSER_TAB_DRAG_MIME_TYPE, parseBrowserTabDragData } from "../browserTabDrag";
import { isSameThreadRef, useSplitPaneStore } from "../splitPaneStore";
import { parseThreadDragData, THREAD_DRAG_MIME_TYPE } from "../threadDrag";
import { useWorkspaceViewStore, WORKSPACE_PREVIEW_TAB_ID } from "../workspaceViewStore";
import { parseWorkspaceTabDragData, WORKSPACE_TAB_DRAG_MIME_TYPE } from "../workspaceTabDrag";

const DiffPanel = lazy(() => import("../components/DiffPanel"));
const DIFF_INLINE_SIDEBAR_WIDTH_STORAGE_KEY = "chat_diff_sidebar_width";
const DIFF_INLINE_DEFAULT_WIDTH = "clamp(24rem,34vw,36rem)";
const DIFF_INLINE_SIDEBAR_MIN_WIDTH = 22 * 16;
const DIFF_INLINE_SIDEBAR_MAX_WIDTH = 256 * 16;
const COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX = 208;

const DiffLoadingFallback = (props: { mode: DiffPanelMode }) => {
  return (
    <DiffPanelShell mode={props.mode} header={<DiffPanelHeaderSkeleton />}>
      <DiffPanelLoadingState label="Loading diff viewer..." />
    </DiffPanelShell>
  );
};

const LazyDiffPanel = (props: { mode: DiffPanelMode }) => {
  return (
    <DiffWorkerPoolProvider>
      <Suspense fallback={<DiffLoadingFallback mode={props.mode} />}>
        <DiffPanel mode={props.mode} />
      </Suspense>
    </DiffWorkerPoolProvider>
  );
};

const DiffPanelInlineSidebar = (props: {
  diffOpen: boolean;
  onCloseDiff: () => void;
  onOpenDiff: () => void;
  renderDiffContent: boolean;
}) => {
  const { diffOpen, onCloseDiff, onOpenDiff, renderDiffContent } = props;
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        onOpenDiff();
        return;
      }
      onCloseDiff();
    },
    [onCloseDiff, onOpenDiff],
  );
  const shouldAcceptInlineSidebarWidth = useCallback(
    ({ nextWidth, wrapper }: { nextWidth: number; wrapper: HTMLElement }) => {
      const composerForm = document.querySelector<HTMLElement>("[data-chat-composer-form='true']");
      if (!composerForm) return true;
      const composerViewport = composerForm.parentElement;
      if (!composerViewport) return true;
      const previousSidebarWidth = wrapper.style.getPropertyValue("--sidebar-width");
      wrapper.style.setProperty("--sidebar-width", `${nextWidth}px`);

      const viewportStyle = window.getComputedStyle(composerViewport);
      const viewportPaddingLeft = Number.parseFloat(viewportStyle.paddingLeft) || 0;
      const viewportPaddingRight = Number.parseFloat(viewportStyle.paddingRight) || 0;
      const viewportContentWidth = Math.max(
        0,
        composerViewport.clientWidth - viewportPaddingLeft - viewportPaddingRight,
      );
      const formRect = composerForm.getBoundingClientRect();
      const composerFooter = composerForm.querySelector<HTMLElement>(
        "[data-chat-composer-footer='true']",
      );
      const composerRightActions = composerForm.querySelector<HTMLElement>(
        "[data-chat-composer-actions='right']",
      );
      const composerRightActionsWidth = composerRightActions?.getBoundingClientRect().width ?? 0;
      const composerFooterGap = composerFooter
        ? Number.parseFloat(window.getComputedStyle(composerFooter).columnGap) ||
          Number.parseFloat(window.getComputedStyle(composerFooter).gap) ||
          0
        : 0;
      const minimumComposerWidth =
        COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX + composerRightActionsWidth + composerFooterGap;
      const hasComposerOverflow = composerForm.scrollWidth > composerForm.clientWidth + 0.5;
      const overflowsViewport = formRect.width > viewportContentWidth + 0.5;
      const violatesMinimumComposerWidth = composerForm.clientWidth + 0.5 < minimumComposerWidth;

      if (previousSidebarWidth.length > 0) {
        wrapper.style.setProperty("--sidebar-width", previousSidebarWidth);
      } else {
        wrapper.style.removeProperty("--sidebar-width");
      }

      return !hasComposerOverflow && !overflowsViewport && !violatesMinimumComposerWidth;
    },
    [],
  );

  return (
    <SidebarProvider
      defaultOpen={false}
      open={diffOpen}
      onOpenChange={onOpenChange}
      className="w-auto min-h-0 flex-none bg-transparent"
      style={{ "--sidebar-width": DIFF_INLINE_DEFAULT_WIDTH } as React.CSSProperties}
    >
      <Sidebar
        side="right"
        collapsible="offcanvas"
        className="border-l border-border bg-card text-foreground"
        resizable={{
          maxWidth: DIFF_INLINE_SIDEBAR_MAX_WIDTH,
          minWidth: DIFF_INLINE_SIDEBAR_MIN_WIDTH,
          shouldAcceptWidth: shouldAcceptInlineSidebarWidth,
          storageKey: DIFF_INLINE_SIDEBAR_WIDTH_STORAGE_KEY,
        }}
      >
        {renderDiffContent ? <LazyDiffPanel mode="sidebar" /> : null}
        <SidebarRail />
      </Sidebar>
    </SidebarProvider>
  );
};

function ChatThreadRouteView() {
  const navigate = useNavigate();
  const threadRef = Route.useParams({
    select: (params) => resolveThreadRouteRef(params),
  });
  const search = Route.useSearch();
  const bootstrapComplete = useStore(
    (store) => selectEnvironmentState(store, threadRef?.environmentId ?? null).bootstrapComplete,
  );
  const serverThread = useStore(useMemo(() => createThreadSelectorByRef(threadRef), [threadRef]));
  const threadExists = useStore((store) => selectThreadExistsByRef(store, threadRef));
  const environmentHasServerThreads = useStore(
    (store) => selectEnvironmentState(store, threadRef?.environmentId ?? null).threadIds.length > 0,
  );
  const draftThreadExists = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) !== null : false,
  );
  const draftThread = useComposerDraftStore((store) =>
    threadRef ? store.getDraftThreadByRef(threadRef) : null,
  );
  const environmentHasDraftThreads = useComposerDraftStore((store) => {
    if (!threadRef) {
      return false;
    }
    return store.hasDraftThreadsInEnvironment(threadRef.environmentId);
  });
  const routeThreadExists = threadExists || draftThreadExists;
  const serverThreadStarted = threadHasStarted(serverThread);
  const environmentHasAnyThreads = environmentHasServerThreads || environmentHasDraftThreads;
  const diffOpen = search.diff === "1";
  const shouldUseDiffSheet = useMediaQuery(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY);
  const currentThreadKey = threadRef ? `${threadRef.environmentId}:${threadRef.threadId}` : null;
  const secondaryThreadRef = useSplitPaneStore((state) => state.secondaryThreadRef);
  const clearSecondaryThreadRef = useSplitPaneStore((state) => state.clearSecondaryThreadRef);
  const focusPane = useSplitPaneStore((state) => state.focusPane);
  const splitRatio = useSplitPaneStore((state) => state.splitRatio);
  const setSplitRatio = useSplitPaneStore((state) => state.setSplitRatio);
  const moveWorkspaceTab = useWorkspaceViewStore((state) => state.moveWorkspaceTab);
  const setWorkspaceActiveTab = useWorkspaceViewStore((state) => state.setActiveTab);
  const moveBrowserTab = useBrowserStateStore((state) => state.moveBrowserTab);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const [diffPanelMountState, setDiffPanelMountState] = useState(() => ({
    threadKey: currentThreadKey,
    hasOpenedDiff: diffOpen,
  }));
  const showSecondaryPane = Boolean(
    threadRef &&
    secondaryThreadRef &&
    !isSameThreadRef(secondaryThreadRef, {
      environmentId: threadRef.environmentId,
      threadId: threadRef.threadId,
    }),
  );
  const hasOpenedDiff =
    diffPanelMountState.threadKey === currentThreadKey
      ? diffPanelMountState.hasOpenedDiff
      : diffOpen;
  const markDiffOpened = useCallback(() => {
    setDiffPanelMountState((previous) => {
      if (previous.threadKey === currentThreadKey && previous.hasOpenedDiff) {
        return previous;
      }
      return {
        threadKey: currentThreadKey,
        hasOpenedDiff: true,
      };
    });
  }, [currentThreadKey]);
  const closeDiff = useCallback(() => {
    if (!threadRef) {
      return;
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
      search: { diff: undefined },
    });
  }, [navigate, threadRef]);
  const openDiff = useCallback(() => {
    if (!threadRef) {
      return;
    }
    markDiffOpened();
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(threadRef),
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return { ...rest, diff: "1" };
      },
    });
  }, [markDiffOpened, navigate, threadRef]);
  const handlePaneDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    if (
      !event.dataTransfer.types.includes(THREAD_DRAG_MIME_TYPE) &&
      !event.dataTransfer.types.includes(BROWSER_TAB_DRAG_MIME_TYPE) &&
      !event.dataTransfer.types.includes(WORKSPACE_TAB_DRAG_MIME_TYPE)
    ) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);
  const handlePrimaryPaneDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const droppedBrowserTab = parseBrowserTabDragData(
        event.dataTransfer.getData(BROWSER_TAB_DRAG_MIME_TYPE),
      );
      if (droppedBrowserTab && threadRef) {
        event.preventDefault();
        moveBrowserTab(
          droppedBrowserTab.sourceThreadRef.threadId,
          threadRef.threadId,
          droppedBrowserTab.tabId,
        );
        setWorkspaceActiveTab(droppedBrowserTab.sourceThreadRef.threadId, null);
        setWorkspaceActiveTab(threadRef.threadId, WORKSPACE_PREVIEW_TAB_ID);
        focusPane("primary");
        return;
      }
      const droppedWorkspaceTab = parseWorkspaceTabDragData(
        event.dataTransfer.getData(WORKSPACE_TAB_DRAG_MIME_TYPE),
      );
      if (droppedWorkspaceTab && threadRef) {
        event.preventDefault();
        moveWorkspaceTab(
          droppedWorkspaceTab.sourceThreadRef.threadId,
          threadRef.threadId,
          droppedWorkspaceTab.tabId,
        );
        focusPane("primary");
        return;
      }
      const droppedThreadRef = parseThreadDragData(
        event.dataTransfer.getData(THREAD_DRAG_MIME_TYPE),
      );
      if (!droppedThreadRef) {
        return;
      }
      event.preventDefault();
      focusPane("primary");
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(droppedThreadRef),
      });
    },
    [focusPane, moveBrowserTab, moveWorkspaceTab, navigate, setWorkspaceActiveTab, threadRef],
  );
  const handleSecondaryPaneDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      const droppedBrowserTab = parseBrowserTabDragData(
        event.dataTransfer.getData(BROWSER_TAB_DRAG_MIME_TYPE),
      );
      if (droppedBrowserTab && secondaryThreadRef) {
        event.preventDefault();
        moveBrowserTab(
          droppedBrowserTab.sourceThreadRef.threadId,
          secondaryThreadRef.threadId,
          droppedBrowserTab.tabId,
        );
        setWorkspaceActiveTab(droppedBrowserTab.sourceThreadRef.threadId, null);
        setWorkspaceActiveTab(secondaryThreadRef.threadId, WORKSPACE_PREVIEW_TAB_ID);
        focusPane("secondary");
        return;
      }
      const droppedWorkspaceTab = parseWorkspaceTabDragData(
        event.dataTransfer.getData(WORKSPACE_TAB_DRAG_MIME_TYPE),
      );
      if (droppedWorkspaceTab && secondaryThreadRef) {
        event.preventDefault();
        moveWorkspaceTab(
          droppedWorkspaceTab.sourceThreadRef.threadId,
          secondaryThreadRef.threadId,
          droppedWorkspaceTab.tabId,
        );
        focusPane("secondary");
        return;
      }
      const droppedThreadRef = parseThreadDragData(
        event.dataTransfer.getData(THREAD_DRAG_MIME_TYPE),
      );
      if (!droppedThreadRef) {
        return;
      }
      event.preventDefault();
      if (
        threadRef &&
        droppedThreadRef.environmentId === threadRef.environmentId &&
        droppedThreadRef.threadId === threadRef.threadId
      ) {
        focusPane("secondary");
        return;
      }
      useSplitPaneStore.getState().setSecondaryThreadRef(droppedThreadRef);
      focusPane("secondary");
    },
    [
      focusPane,
      moveBrowserTab,
      moveWorkspaceTab,
      secondaryThreadRef,
      setWorkspaceActiveTab,
      threadRef,
    ],
  );

  useEffect(() => {
    if (!threadRef || !bootstrapComplete) {
      return;
    }

    if (!routeThreadExists && environmentHasAnyThreads) {
      void navigate({ to: "/", replace: true });
    }
  }, [bootstrapComplete, environmentHasAnyThreads, navigate, routeThreadExists, threadRef]);

  useEffect(() => {
    if (!threadRef || !serverThreadStarted || !draftThread?.promotedTo) {
      return;
    }
    finalizePromotedDraftThreadByRef(threadRef);
  }, [draftThread?.promotedTo, serverThreadStarted, threadRef]);

  useEffect(() => {
    if (threadRef && secondaryThreadRef && isSameThreadRef(secondaryThreadRef, threadRef)) {
      clearSecondaryThreadRef();
    }
  }, [clearSecondaryThreadRef, secondaryThreadRef, threadRef]);

  const handleSplitDividerMouseDown = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const container = splitContainerRef.current;
        if (!container) {
          return;
        }
        const rect = container.getBoundingClientRect();
        if (rect.width <= 0) {
          return;
        }
        setSplitRatio((moveEvent.clientX - rect.left) / rect.width);
      };

      const handleMouseUp = () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [setSplitRatio],
  );

  if (!threadRef || !bootstrapComplete || !routeThreadExists) {
    return null;
  }

  const shouldRenderDiffContent = diffOpen || hasOpenedDiff;
  const chatContent = (
    <div ref={splitContainerRef} className="flex min-h-0 flex-1">
      <SidebarInset
        className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground"
        style={showSecondaryPane ? { flex: `0 0 ${splitRatio * 100}%` } : undefined}
      >
        <div
          className="flex h-full min-h-0 flex-1"
          data-testid="chat-pane-primary"
          onMouseDown={() => focusPane("primary")}
          onDragOver={handlePaneDragOver}
          onDrop={handlePrimaryPaneDrop}
        >
          <ChatView
            environmentId={threadRef.environmentId}
            threadId={threadRef.threadId}
            routeKind="server"
          />
        </div>
      </SidebarInset>
      {showSecondaryPane && secondaryThreadRef ? (
        <button
          type="button"
          aria-label="Resize split panes"
          data-testid="chat-split-divider"
          className="h-dvh min-h-0 w-1 shrink-0 cursor-col-resize bg-border/80 transition-colors hover:bg-border"
          onMouseDown={handleSplitDividerMouseDown}
        />
      ) : null}
      {showSecondaryPane && secondaryThreadRef ? (
        <SidebarInset
          className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground"
          style={showSecondaryPane ? { flex: `1 1 ${100 - splitRatio * 100}%` } : undefined}
        >
          <div
            className="flex h-full min-h-0 flex-1"
            data-testid="chat-pane-secondary"
            onMouseDown={() => focusPane("secondary")}
            onDragOver={handlePaneDragOver}
            onDrop={handleSecondaryPaneDrop}
          >
            <ChatView
              environmentId={secondaryThreadRef.environmentId}
              threadId={secondaryThreadRef.threadId}
              routeKind="server"
            />
          </div>
        </SidebarInset>
      ) : null}
    </div>
  );

  if (!shouldUseDiffSheet) {
    return (
      <>
        <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
          <ChatView
            environmentId={threadRef.environmentId}
            threadId={threadRef.threadId}
            onDiffPanelOpen={markDiffOpened}
            reserveTitleBarControlInset={!diffOpen}
            routeKind="server"
          />
        </SidebarInset>
        <DiffPanelInlineSidebar
          diffOpen={diffOpen}
          onCloseDiff={closeDiff}
          onOpenDiff={openDiff}
          renderDiffContent={shouldRenderDiffContent}
        />
      </>
    );
  }

  return (
    <>
      <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
        <ChatView
          environmentId={threadRef.environmentId}
          threadId={threadRef.threadId}
          onDiffPanelOpen={markDiffOpened}
          routeKind="server"
        />
      </SidebarInset>
      <RightPanelSheet open={diffOpen} onClose={closeDiff}>
        {shouldRenderDiffContent ? <LazyDiffPanel mode="sheet" /> : null}
      </RightPanelSheet>
    </>
  );
}

export const Route = createFileRoute("/_chat/$environmentId/$threadId")({
  validateSearch: (search) => parseDiffRouteSearch(search),
  search: {
    middlewares: [retainSearchParams<DiffRouteSearch>(["diff"])],
  },
  component: ChatThreadRouteView,
});
