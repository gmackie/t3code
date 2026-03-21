/**
 * @t3tools/extension-api — Public contract for T3 Code extensions.
 *
 * Extensions implement T3ExtensionDefinition and receive ExtensionContext
 * from the host. This package defines the stable API boundary between
 * the extension host (in the web app) and extension implementations
 * (which can live in separate packages or repos).
 *
 * ARCHITECTURE:
 *
 *   @t3tools/extension-api (this package)
 *   ├── T3ExtensionDefinition — what extensions implement
 *   ├── ExtensionContext — what the host provides
 *   └── ExtensionThreadView — read-only thread state
 *
 *   Extension package (e.g., @t3tools/ext-planning-workbench)
 *   ├── depends on @t3tools/extension-api
 *   └── exports a T3ExtensionDefinition
 *
 *   @t3tools/web (the app)
 *   ├── depends on extension packages
 *   ├── registers extensions in builtinRegistry.ts
 *   └── hosts them via ExtensionHost.tsx
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

// ─── Thread & Project (read-only views for extensions) ───

export interface ExtensionProject {
  id: ProjectId;
  name: string;
  cwd: string;
  model: string;
  scripts: ProjectScript[];
}

export interface ExtensionThread {
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

// ─── Derived session state (read-only for extensions) ───

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

// ─── Extension API ───

export type ExtensionSurface = "thread.sidePanel" | "thread.headerActions" | "project.toolView";

export interface ExtensionThreadView {
  thread: ExtensionThread;
  project: ExtensionProject | null;
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
