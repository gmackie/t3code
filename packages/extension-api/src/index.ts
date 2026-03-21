/**
 * @t3tools/extension-api — Public contract for T3 Code panels.
 *
 * Panels implement PanelDefinition and receive PanelContext from the host.
 * This package defines the stable API boundary between the panel host
 * (in the web app) and panel implementations (which can live in separate
 * packages or repos).
 *
 * ARCHITECTURE:
 *
 *   @t3tools/extension-api (this package)
 *   ├── PanelDefinition — what panels implement
 *   ├── PanelContext — what the host provides
 *   └── PanelThreadView — read-only thread state
 *
 *   Panel package (e.g., @t3tools/ext-planning-workbench)
 *   ├── depends on @t3tools/extension-api
 *   └── exports a PanelDefinition
 *
 *   @t3tools/web (the app)
 *   ├── depends on panel packages
 *   ├── registers panels in panelRegistry.ts
 *   └── hosts them via PanelHost.tsx
 */

import type { ReactNode } from "react";
import type {
  ApprovalRequestId,
  OrchestrationProposedPlanId,
  ProjectId,
  ProjectScript,
  ThreadId,
  TurnId,
  RuntimeMode,
  ProviderInteractionMode,
  OrchestrationLatestTurn,
} from "@t3tools/contracts";

// ─── Thread & Project (read-only views for panels) ───

export interface PanelProject {
  id: ProjectId;
  name: string;
  cwd: string;
  model: string;
  scripts: ProjectScript[];
}

export interface PanelThread {
  id: ThreadId;
  projectId: ProjectId;
  title: string;
  model: string;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  branch: string | null;
  worktreePath: string | null;
  createdAt: string;
  latestTurn: OrchestrationLatestTurn | null;
}

// ─── Derived session state (read-only for panels) ───

export interface ActivePlanState {
  createdAt: string;
  turnId: TurnId | null;
  explanation?: string | null;
  steps: Array<{
    step: string;
    status: "pending" | "inProgress" | "completed";
  }>;
}

export interface LatestProposedPlanState {
  id: OrchestrationProposedPlanId;
  createdAt: string;
  updatedAt: string;
  turnId: TurnId | null;
  planMarkdown: string;
  implementedAt: string | null;
  implementationThreadId: ThreadId | null;
}

export interface PendingApproval {
  requestId: ApprovalRequestId;
  requestKind: "command" | "file-read" | "file-change";
  createdAt: string;
  detail?: string;
}

export interface PendingUserInput {
  requestId: ApprovalRequestId;
  createdAt: string;
  questions: ReadonlyArray<{ question: string }>;
}

export interface WorkLogEntry {
  id: string;
  createdAt: string;
  label: string;
  detail?: string;
  command?: string;
  changedFiles?: ReadonlyArray<string>;
  tone: "thinking" | "tool" | "info" | "error";
}

// ─── Panel API ───

export type PanelSurface = "thread.sidePanel";

export interface PanelThreadView {
  thread: PanelThread;
  project: PanelProject | null;
  activePlan: ActivePlanState | null;
  latestProposedPlan: LatestProposedPlanState | null;
  pendingApprovals: PendingApproval[];
  pendingUserInputs: PendingUserInput[];
  workLog: WorkLogEntry[];
  latestTurnId: TurnId | null;
}

export interface PanelContext {
  activeThreadId: ThreadId | null;
  threadView: PanelThreadView | null;
}

export interface PanelDefinition {
  id: string;
  title: string;
  surface: PanelSurface;
  order?: number;
  isAvailable: (context: PanelContext) => boolean;
  render: (context: PanelContext) => ReactNode;
}
