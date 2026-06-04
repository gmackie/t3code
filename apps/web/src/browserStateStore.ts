import type { BrowserAutomationState, ThreadId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { type BrowserTab } from "./browser";

export interface ThreadBrowserState {
  activeTabId: string | null;
  tabs: BrowserTab[];
  inputValue: string;
  focusRequestId: number;
  automationState: BrowserAutomationState | undefined;
}

const BROWSER_STATE_STORAGE_KEY = "t3code:browser-state:v1";

const DEFAULT_THREAD_BROWSER_STATE: ThreadBrowserState = Object.freeze({
  activeTabId: null,
  tabs: [],
  inputValue: "",
  focusRequestId: 0,
  automationState: undefined,
});

function createDefaultThreadBrowserState(): ThreadBrowserState {
  return {
    ...DEFAULT_THREAD_BROWSER_STATE,
    tabs: [],
  };
}

function threadBrowserStateEqual(left: ThreadBrowserState, right: ThreadBrowserState): boolean {
  return (
    left.activeTabId === right.activeTabId &&
    left.inputValue === right.inputValue &&
    left.focusRequestId === right.focusRequestId &&
    left.automationState?.status === right.automationState?.status &&
    left.automationState?.tabId === right.automationState?.tabId &&
    left.automationState?.message === right.automationState?.message &&
    left.tabs === right.tabs
  );
}

function isValidBrowserTab(tab: BrowserTab): boolean {
  return (
    typeof tab.id === "string" &&
    tab.id.trim().length > 0 &&
    typeof tab.url === "string" &&
    tab.url.length > 0
  );
}

function normalizeThreadBrowserState(state: ThreadBrowserState): ThreadBrowserState {
  let tabsChanged = false;
  const nextTabs: BrowserTab[] = [];
  for (const tab of state.tabs) {
    if (!isValidBrowserTab(tab)) {
      tabsChanged = true;
      continue;
    }
    nextTabs.push(tab);
  }
  const tabs = tabsChanged ? nextTabs : state.tabs;
  const activeTabId =
    state.activeTabId && tabs.some((tab) => tab.id === state.activeTabId)
      ? state.activeTabId
      : (tabs[0]?.id ?? null);
  const normalized: ThreadBrowserState = {
    activeTabId,
    tabs,
    inputValue: state.inputValue,
    focusRequestId:
      Number.isFinite(state.focusRequestId) && state.focusRequestId > 0
        ? Math.trunc(state.focusRequestId)
        : 0,
    automationState: state.automationState,
  };
  return threadBrowserStateEqual(state, normalized) ? state : normalized;
}

function isDefaultThreadBrowserState(state: ThreadBrowserState): boolean {
  const normalized = normalizeThreadBrowserState(state);
  return (
    normalized.activeTabId === DEFAULT_THREAD_BROWSER_STATE.activeTabId &&
    normalized.inputValue === DEFAULT_THREAD_BROWSER_STATE.inputValue &&
    normalized.focusRequestId === DEFAULT_THREAD_BROWSER_STATE.focusRequestId &&
    normalized.automationState === DEFAULT_THREAD_BROWSER_STATE.automationState &&
    normalized.tabs.length === 0
  );
}

export function selectThreadBrowserState(
  browserStateByThreadId: Record<ThreadId, ThreadBrowserState>,
  threadId: ThreadId,
): ThreadBrowserState {
  if (threadId.length === 0) {
    return DEFAULT_THREAD_BROWSER_STATE;
  }
  return browserStateByThreadId[threadId] ?? DEFAULT_THREAD_BROWSER_STATE;
}

function updateBrowserStateByThreadId(
  browserStateByThreadId: Record<ThreadId, ThreadBrowserState>,
  threadId: ThreadId,
  updater: (state: ThreadBrowserState) => ThreadBrowserState,
): Record<ThreadId, ThreadBrowserState> {
  if (threadId.length === 0) {
    return browserStateByThreadId;
  }

  const current = selectThreadBrowserState(browserStateByThreadId, threadId);
  const next = normalizeThreadBrowserState(updater(current));
  if (next === current || threadBrowserStateEqual(current, next)) {
    return browserStateByThreadId;
  }

  if (isDefaultThreadBrowserState(next)) {
    if (browserStateByThreadId[threadId] === undefined) {
      return browserStateByThreadId;
    }
    const { [threadId]: _removed, ...rest } = browserStateByThreadId;
    return rest as Record<ThreadId, ThreadBrowserState>;
  }

  return {
    ...browserStateByThreadId,
    [threadId]: next,
  };
}

interface BrowserStateStoreState {
  browserStateByThreadId: Record<ThreadId, ThreadBrowserState>;
  updateThreadBrowserState: (
    threadId: ThreadId,
    updater: (state: ThreadBrowserState) => ThreadBrowserState,
  ) => void;
  moveBrowserTab: (sourceThreadId: ThreadId, targetThreadId: ThreadId, tabId: string) => void;
  removeOrphanedBrowserStates: (activeThreadIds: Set<ThreadId>) => void;
  clearBrowserState: (threadId: ThreadId) => void;
}

export const useBrowserStateStore = create<BrowserStateStoreState>()(
  persist(
    (set) => ({
      browserStateByThreadId: {},
      updateThreadBrowserState: (threadId, updater) =>
        set((state) => {
          const nextBrowserStateByThreadId = updateBrowserStateByThreadId(
            state.browserStateByThreadId,
            threadId,
            updater,
          );
          if (nextBrowserStateByThreadId === state.browserStateByThreadId) {
            return state;
          }
          return { browserStateByThreadId: nextBrowserStateByThreadId };
        }),
      moveBrowserTab: (sourceThreadId, targetThreadId, tabId) =>
        set((state) => {
          if (
            sourceThreadId.length === 0 ||
            targetThreadId.length === 0 ||
            sourceThreadId === targetThreadId
          ) {
            return state;
          }

          const sourceState = selectThreadBrowserState(
            state.browserStateByThreadId,
            sourceThreadId,
          );
          const movedTab = sourceState.tabs.find((tab) => tab.id === tabId);
          if (!movedTab) {
            return state;
          }

          const nextSourceTabs = sourceState.tabs.filter((tab) => tab.id !== tabId);
          const nextSourceActiveTabId =
            sourceState.activeTabId === tabId
              ? (nextSourceTabs[0]?.id ?? null)
              : sourceState.activeTabId;
          const targetState = selectThreadBrowserState(
            state.browserStateByThreadId,
            targetThreadId,
          );
          const nextTargetTabs = targetState.tabs.some((tab) => tab.id === tabId)
            ? targetState.tabs.map((tab) => (tab.id === tabId ? movedTab : tab))
            : [...targetState.tabs, movedTab];

          const withoutSource = updateBrowserStateByThreadId(
            state.browserStateByThreadId,
            sourceThreadId,
            (current) => ({
              ...current,
              activeTabId: nextSourceActiveTabId,
              tabs: nextSourceTabs,
            }),
          );
          const withTarget = updateBrowserStateByThreadId(
            withoutSource,
            targetThreadId,
            (current) => ({
              ...current,
              activeTabId: tabId,
              tabs: nextTargetTabs,
            }),
          );
          return withTarget === state.browserStateByThreadId
            ? state
            : { browserStateByThreadId: withTarget };
        }),
      removeOrphanedBrowserStates: (activeThreadIds) =>
        set((state) => {
          const orphanedIds = Object.keys(state.browserStateByThreadId).filter(
            (id) => !activeThreadIds.has(id as ThreadId),
          );
          if (orphanedIds.length === 0) {
            return state;
          }
          const next = { ...state.browserStateByThreadId };
          for (const id of orphanedIds) {
            delete next[id as ThreadId];
          }
          return { browserStateByThreadId: next };
        }),
      clearBrowserState: (threadId) =>
        set((state) => ({
          browserStateByThreadId: updateBrowserStateByThreadId(
            state.browserStateByThreadId,
            threadId,
            () => createDefaultThreadBrowserState(),
          ),
        })),
    }),
    {
      name: BROWSER_STATE_STORAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        browserStateByThreadId: state.browserStateByThreadId,
      }),
    },
  ),
);
