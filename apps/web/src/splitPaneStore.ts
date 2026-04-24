import { create } from "zustand";

import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import type { ScopedThreadRef } from "@t3tools/contracts";

interface SplitPaneStoreState {
  secondaryThreadRef: ScopedThreadRef | null;
  focusedPane: "primary" | "secondary";
  splitRatio: number;
  setSecondaryThreadRef: (threadRef: ScopedThreadRef | null) => void;
  clearSecondaryThreadRef: () => void;
  focusPane: (pane: "primary" | "secondary") => void;
  setSplitRatio: (ratio: number) => void;
}

const DEFAULT_SPLIT_RATIO = 0.5;
const MIN_SPLIT_RATIO = 0.2;
const MAX_SPLIT_RATIO = 0.8;

function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) {
    return DEFAULT_SPLIT_RATIO;
  }
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio));
}

function refsEqual(left: ScopedThreadRef | null, right: ScopedThreadRef | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.environmentId === right.environmentId && left.threadId === right.threadId;
}

export const useSplitPaneStore = create<SplitPaneStoreState>()((set) => ({
  secondaryThreadRef: null,
  focusedPane: "primary",
  splitRatio: DEFAULT_SPLIT_RATIO,
  setSecondaryThreadRef: (threadRef) =>
    set((state) => {
      if (refsEqual(state.secondaryThreadRef, threadRef)) {
        return state;
      }
      return {
        secondaryThreadRef: threadRef,
        focusedPane: threadRef === null ? "primary" : "secondary",
      };
    }),
  clearSecondaryThreadRef: () =>
    set((state) =>
      state.secondaryThreadRef === null
        ? state
        : { secondaryThreadRef: null, focusedPane: "primary" },
    ),
  focusPane: (pane) =>
    set((state) => {
      if (pane === "secondary" && state.secondaryThreadRef === null) {
        return state;
      }
      return state.focusedPane === pane ? state : { focusedPane: pane };
    }),
  setSplitRatio: (ratio) =>
    set((state) => {
      const nextRatio = clampSplitRatio(ratio);
      return state.splitRatio === nextRatio ? state : { splitRatio: nextRatio };
    }),
}));

export function isSameThreadRef(
  left: ScopedThreadRef | null,
  right: { environmentId: EnvironmentId; threadId: ThreadId } | null,
): boolean {
  if (!left || !right) return false;
  return left.environmentId === right.environmentId && left.threadId === right.threadId;
}
