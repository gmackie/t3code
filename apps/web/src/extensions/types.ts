import type { ReactNode } from "react";
import type { ThreadId, TurnId } from "@t3tools/contracts";

import type {
  ActivePlanState,
  LatestProposedPlanState,
  PendingApproval,
  PendingUserInput,
  WorkLogEntry,
} from "../session-logic";
import type { Project, Thread } from "../types";

export type ExtensionSurface = "thread.sidePanel" | "thread.headerActions" | "project.toolView";

export interface ExtensionThreadView {
  thread: Thread;
  project: Project | null;
  activePlan: ActivePlanState | null;
  latestProposedPlan: LatestProposedPlanState | null;
  pendingApprovals: PendingApproval[];
  pendingUserInputs: PendingUserInput[];
  workLog: WorkLogEntry[];
  latestTurnId: TurnId | null;
}

export interface HostWorkflowAction {
  id: string;
  label: string;
  disabled?: boolean;
  run: () => Promise<void> | void;
}

export interface ExtensionContext {
  activeThreadId: ThreadId | null;
  threadView: ExtensionThreadView | null;
  openSidePanel: (panelId: string) => void;
  closeSidePanel: () => void;
  actions: ReadonlyArray<HostWorkflowAction>;
}

export interface T3ExtensionDefinition {
  id: string;
  title: string;
  surface: ExtensionSurface;
  order?: number;
  isAvailable: (context: ExtensionContext) => boolean;
  render: (context: ExtensionContext) => ReactNode;
}
