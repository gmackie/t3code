/**
 * Extension types — re-exported from @t3tools/extension-api.
 *
 * The web app uses these types internally. Extension packages import
 * from @t3tools/extension-api directly. This re-export keeps existing
 * imports working without changing every file.
 */
export type {
  ActivePlanState,
  ExtensionContext,
  ExtensionProject,
  ExtensionSurface,
  ExtensionThread,
  ExtensionThreadView,
  HostWorkflowAction,
  LatestProposedPlanState,
  PendingApproval,
  PendingUserInput,
  T3ExtensionDefinition,
  WorkLogEntry,
} from "@t3tools/extension-api";
