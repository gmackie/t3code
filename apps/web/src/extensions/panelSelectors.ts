import type { ThreadId } from "@t3tools/contracts";

import {
  deriveActivePlanState,
  derivePendingApprovals,
  derivePendingUserInputs,
  deriveWorkLogEntries,
  findLatestProposedPlan,
  isLatestTurnSettled,
} from "../session-logic";
import type { AppState } from "../store";
import type { PanelThreadView } from "./types";

export type PanelSelectorState = Pick<AppState, "projects" | "threads" | "threadsHydrated">;

let cachedThreadId: ThreadId | null = null;
let cachedThread: unknown = null;
let cachedProject: unknown = null;
let cachedResult: PanelThreadView | null = null;

export function selectPanelThreadView(
  state: PanelSelectorState,
  threadId: ThreadId | null,
): PanelThreadView | null {
  if (!threadId) return null;

  const thread = state.threads.find((candidate) => candidate.id === threadId);
  if (!thread) return null;

  const project = state.projects.find((candidate) => candidate.id === thread.projectId) ?? null;

  // Return cached result if the thread and project objects haven't changed
  if (threadId === cachedThreadId && thread === cachedThread && project === cachedProject) {
    return cachedResult;
  }

  const latestTurn = thread.latestTurn;
  const activities = thread.activities;
  const latestTurnSettled = isLatestTurnSettled(latestTurn, thread.session);

  const result: PanelThreadView = {
    thread,
    project,
    activePlan: deriveActivePlanState(activities, latestTurn?.turnId ?? undefined),
    latestProposedPlan: latestTurnSettled
      ? findLatestProposedPlan(thread.proposedPlans, latestTurn?.turnId ?? null)
      : null,
    pendingApprovals: derivePendingApprovals(activities),
    pendingUserInputs: derivePendingUserInputs(activities),
    workLog: deriveWorkLogEntries(activities, latestTurn?.turnId ?? undefined),
    latestTurnId: latestTurn?.turnId ?? null,
  };

  cachedThreadId = threadId;
  cachedThread = thread;
  cachedProject = project;
  cachedResult = result;

  return result;
}
