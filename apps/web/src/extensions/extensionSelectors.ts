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
import type { ExtensionThreadView } from "./types";

export type ExtensionSelectorState = Pick<AppState, "projects" | "threads" | "threadsHydrated">;

export function selectExtensionThreadView(
  state: ExtensionSelectorState,
  threadId: ThreadId | null,
): ExtensionThreadView | null {
  if (!threadId) return null;

  const thread = state.threads.find((candidate) => candidate.id === threadId);
  if (!thread) return null;

  const latestTurn = thread.latestTurn;
  const activities = thread.activities;
  const project = state.projects.find((candidate) => candidate.id === thread.projectId) ?? null;
  const latestTurnSettled = isLatestTurnSettled(latestTurn, thread.session);

  return {
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
}
