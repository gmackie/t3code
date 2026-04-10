import type { ThreadId } from "@t3tools/contracts";
import { create } from "zustand";

export type WorkspaceSidebarMode = "projects" | "files";

export interface WorkspaceFileTab {
  id: string;
  cwd: string;
  relativePath: string;
  line: number | null;
  column: number | null;
}

export interface ThreadWorkspaceViewState {
  activeTabId: string | null;
  tabs: WorkspaceFileTab[];
}

const DEFAULT_THREAD_WORKSPACE_VIEW_STATE: ThreadWorkspaceViewState = Object.freeze({
  activeTabId: null,
  tabs: [],
});

function makeWorkspaceFileTabId(input: { cwd: string; relativePath: string }) {
  return `${input.cwd}:${input.relativePath}`;
}

export function selectThreadWorkspaceViewState(
  workspaceViewByThreadId: Record<ThreadId, ThreadWorkspaceViewState>,
  threadId: ThreadId,
): ThreadWorkspaceViewState {
  if (threadId.length === 0) {
    return DEFAULT_THREAD_WORKSPACE_VIEW_STATE;
  }
  return workspaceViewByThreadId[threadId] ?? DEFAULT_THREAD_WORKSPACE_VIEW_STATE;
}

function updateThreadWorkspaceViewState(
  workspaceViewByThreadId: Record<ThreadId, ThreadWorkspaceViewState>,
  threadId: ThreadId,
  updater: (state: ThreadWorkspaceViewState) => ThreadWorkspaceViewState,
): Record<ThreadId, ThreadWorkspaceViewState> {
  if (threadId.length === 0) {
    return workspaceViewByThreadId;
  }

  const current = selectThreadWorkspaceViewState(workspaceViewByThreadId, threadId);
  const next = updater(current);
  if (next === current) {
    return workspaceViewByThreadId;
  }

  if (next.tabs.length === 0 && next.activeTabId === null) {
    if (workspaceViewByThreadId[threadId] === undefined) {
      return workspaceViewByThreadId;
    }
    const { [threadId]: _removed, ...rest } = workspaceViewByThreadId;
    return rest as Record<ThreadId, ThreadWorkspaceViewState>;
  }

  return {
    ...workspaceViewByThreadId,
    [threadId]: next,
  };
}

interface WorkspaceViewStoreState {
  sidebarMode: WorkspaceSidebarMode;
  workspaceViewByThreadId: Record<ThreadId, ThreadWorkspaceViewState>;
  setSidebarMode: (mode: WorkspaceSidebarMode) => void;
  toggleSidebarMode: () => void;
  openWorkspaceFile: (
    threadId: ThreadId,
    input: {
      cwd: string;
      relativePath: string;
      line: number | null;
      column: number | null;
    },
  ) => void;
  setActiveTab: (threadId: ThreadId, tabId: string | null) => void;
  closeTab: (threadId: ThreadId, tabId: string) => void;
  syncWorkspaceRoot: (threadId: ThreadId, cwd: string | null) => void;
}

export const useWorkspaceViewStore = create<WorkspaceViewStoreState>()((set) => ({
  sidebarMode: "projects",
  workspaceViewByThreadId: {},
  setSidebarMode: (mode) => set({ sidebarMode: mode }),
  toggleSidebarMode: () =>
    set((state) => ({
      sidebarMode: state.sidebarMode === "projects" ? "files" : "projects",
    })),
  openWorkspaceFile: (threadId, input) =>
    set((state) => ({
      workspaceViewByThreadId: updateThreadWorkspaceViewState(
        state.workspaceViewByThreadId,
        threadId,
        (current) => {
          const id = makeWorkspaceFileTabId({
            cwd: input.cwd,
            relativePath: input.relativePath,
          });
          const existingTab = current.tabs.find((tab) => tab.id === id);
          const nextTab: WorkspaceFileTab = existingTab
            ? {
                ...existingTab,
                line: input.line,
                column: input.column,
              }
            : {
                id,
                cwd: input.cwd,
                relativePath: input.relativePath,
                line: input.line,
                column: input.column,
              };
          return {
            activeTabId: id,
            tabs: existingTab
              ? current.tabs.map((tab) => (tab.id === id ? nextTab : tab))
              : [...current.tabs, nextTab],
          };
        },
      ),
    })),
  setActiveTab: (threadId, tabId) =>
    set((state) => ({
      workspaceViewByThreadId: updateThreadWorkspaceViewState(
        state.workspaceViewByThreadId,
        threadId,
        (current) => {
          if (tabId !== null && !current.tabs.some((tab) => tab.id === tabId)) {
            return current;
          }
          return current.activeTabId === tabId ? current : { ...current, activeTabId: tabId };
        },
      ),
    })),
  closeTab: (threadId, tabId) =>
    set((state) => ({
      workspaceViewByThreadId: updateThreadWorkspaceViewState(
        state.workspaceViewByThreadId,
        threadId,
        (current) => {
          const index = current.tabs.findIndex((tab) => tab.id === tabId);
          if (index < 0) {
            return current;
          }
          const tabs = current.tabs.filter((tab) => tab.id !== tabId);
          if (current.activeTabId !== tabId) {
            return { ...current, tabs };
          }
          const fallbackTab = tabs[index] ?? tabs[index - 1] ?? null;
          return {
            activeTabId: fallbackTab?.id ?? null,
            tabs,
          };
        },
      ),
    })),
  syncWorkspaceRoot: (threadId, cwd) =>
    set((state) => ({
      workspaceViewByThreadId: updateThreadWorkspaceViewState(
        state.workspaceViewByThreadId,
        threadId,
        (current) => {
          const tabs = cwd ? current.tabs.filter((tab) => tab.cwd === cwd) : [];
          const activeTabId =
            current.activeTabId === null
              ? null
              : tabs.some((tab) => tab.id === current.activeTabId)
                ? current.activeTabId
                : (tabs.at(-1)?.id ?? null);
          if (tabs === current.tabs && activeTabId === current.activeTabId) {
            return current;
          }
          return {
            activeTabId,
            tabs,
          };
        },
      ),
    })),
}));
