import type { BrowserAutomationState, ThreadId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { BrowserTab } from "./browser";

export interface ThreadBrowserState {
  activeTabId: string | null;
  tabs: BrowserTab[];
  inputValue: string;
  focusRequestId: number;
  automationState: BrowserAutomationState;
}

const BROWSER_STATE_STORAGE_KEY = "t3code:browser-state:v1";
const DEFAULT_BROWSER_AUTOMATION_STATE: BrowserAutomationState = {
  status: "idle",
  tabId: null,
  message: null,
};

const DEFAULT_THREAD_BROWSER_STATE: ThreadBrowserState = Object.freeze({
  activeTabId: null,
  tabs: [],
  inputValue: "",
  focusRequestId: 0,
  automationState: DEFAULT_BROWSER_AUTOMATION_STATE,
});

function normalizeAutomationState(
  state: BrowserAutomationState | null | undefined,
): BrowserAutomationState {
  if (state?.status === "agent" || state?.status === "user" || state?.status === "idle") {
    return {
      status: state.status,
      tabId: state.tabId ?? null,
      message: state.message ?? null,
    };
  }
  return DEFAULT_BROWSER_AUTOMATION_STATE;
}

function createDefaultThreadBrowserState(): ThreadBrowserState {
  return {
    ...DEFAULT_THREAD_BROWSER_STATE,
    tabs: [],
  };
}

function threadBrowserStateEqual(left: ThreadBrowserState, right: ThreadBrowserState): boolean {
  const leftAutomationState = normalizeAutomationState(left.automationState);
  const rightAutomationState = normalizeAutomationState(right.automationState);
  return (
    left.activeTabId === right.activeTabId &&
    left.inputValue === right.inputValue &&
    left.focusRequestId === right.focusRequestId &&
    leftAutomationState.status === rightAutomationState.status &&
    leftAutomationState.tabId === rightAutomationState.tabId &&
    leftAutomationState.message === rightAutomationState.message &&
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
    automationState: normalizeAutomationState(state.automationState),
  };
  return threadBrowserStateEqual(state, normalized) ? state : normalized;
}

function isDefaultThreadBrowserState(state: ThreadBrowserState): boolean {
  const normalized = normalizeThreadBrowserState(state);
  return (
    normalized.activeTabId === DEFAULT_THREAD_BROWSER_STATE.activeTabId &&
    normalized.inputValue === DEFAULT_THREAD_BROWSER_STATE.inputValue &&
    normalized.focusRequestId === DEFAULT_THREAD_BROWSER_STATE.focusRequestId &&
    normalized.automationState.status === DEFAULT_THREAD_BROWSER_STATE.automationState.status &&
    normalized.automationState.tabId === DEFAULT_THREAD_BROWSER_STATE.automationState.tabId &&
    normalized.automationState.message === DEFAULT_THREAD_BROWSER_STATE.automationState.message &&
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
