/**
 * Re-exports planning workbench logic from the standalone package.
 *
 * The canonical implementation lives in @t3tools/ext-planning-workbench.
 * This module re-exports it for use in the in-app extension component.
 */

export {
  buildPlanningRequirementsMarkdown,
  buildPlanningTaskDrafts,
  type PlanningTaskDraft,
} from "@t3tools/ext-planning-workbench";
