import {
  OrchestratorMcpFailure,
  ProjectId,
  SYSTEMS_EVENTS_PAGE_MAX,
  SYSTEMS_RUN_LIST_MAX,
  SYSTEMS_SIGNAL_POINTS_MAX,
  SystemsCapabilitiesResult,
  SystemsCompileInput,
  SystemsCompileResult,
  SystemsConformanceInput,
  SystemsConformanceResult,
  SystemsError,
  SystemsModelPatchInput,
  SystemsModelPatchResult,
  SystemsModelReadInput,
  SystemsModelReadResult,
  SystemsRun,
  SystemsRunCancelInput,
  SystemsRunCompareInput,
  SystemsRunCompareResult,
  SystemsRunCreateInput,
  SystemsRunEventsInput,
  SystemsRunEventsResult,
  SystemsRunListInput,
  SystemsRunListResult,
  SystemsRunRef,
  SystemsRunSignalsInput,
  SystemsRunSignalsResult,
  SystemsRunWaitInput,
  SystemsSemanticDiffInput,
  SystemsSemanticDiffResult,
  SystemsValidateInput,
  SystemsValidateResult,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as SystemsService from "../../../systems/SystemsService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

/** Defaults small enough that one call never floods an agent's context. */
export const SYSTEMS_TOOL_DEFAULTS = {
  runs: 10,
  events: 50,
  signalPoints: 200,
  waitSeconds: 30,
} as const;

const shared = {
  failure: Schema.Union([OrchestratorMcpFailure, SystemsError]),
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    SystemsService.SystemsService,
  ],
};

const ValidateTool = Tool.make("t3_systems_validate", {
  ...shared,
  description:
    "Validate a systems project (a folder with systems.project.json; path is project-relative) and optional experiments. Lists its experiments and expected traces. Diagnostics carry a code, element id, file and JSON pointer.",
  parameters: SystemsValidateInput,
  success: SystemsValidateResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const CompileTool = Tool.make("t3_systems_compile", {
  ...shared,
  description:
    "Compile one entrypoint, or every one. Returns semantic and plan digests, the schedule and diagnostics. Layout never changes a digest.",
  parameters: SystemsCompileInput,
  success: SystemsCompileResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const SemanticDiffTool = Tool.make("t3_systems_semantic_diff", {
  ...shared,
  description:
    "Added, removed and changed elements between two systems or two statecharts. Layout and ordering never count.",
  parameters: SystemsSemanticDiffInput,
  success: SystemsSemanticDiffResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const ModelReadTool = Tool.make("t3_systems_model_read", {
  ...shared,
  description: "Read one systems document and its revision, for t3_systems_model_patch.",
  parameters: SystemsModelReadInput,
  success: SystemsModelReadResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const ModelPatchTool = Tool.make("t3_systems_model_patch", {
  ...shared,
  description:
    "Apply RFC 6902 add/remove/replace operations to a system, statechart, layout or experiment; pointers match diagnostic pointers. Validates and compiles what the change affects, and writes only when expectedRevision is still current and no error remains. Returns the new revision, diagnostics and a semantic diff. dryRun writes nothing. On conflict, read the file again.",
  parameters: SystemsModelPatchInput,
  success: SystemsModelPatchResult,
}).annotate(Tool.Destructive, false);

const RunCreateTool = Tool.make("t3_systems_run_create", {
  ...shared,
  description:
    "Queue a simulation of an experiment in an isolated worker. Returns at once. Check back with t3_systems_run_wait or t3_systems_run_get; never poll in a loop. The same idempotencyKey returns the same run.",
  parameters: SystemsRunCreateInput,
  success: SystemsRun,
}).annotate(Tool.Destructive, false);

const RunWaitTool = Tool.make("t3_systems_run_wait", {
  ...shared,
  description: `Wait up to timeoutSeconds (default ${SYSTEMS_TOOL_DEFAULTS.waitSeconds}, max 120) for a run to finish, then return it. A timeout does not cancel the run.`,
  parameters: Schema.Struct({
    ...SystemsRunRef.fields,
    timeoutSeconds: Schema.optionalKey(SystemsRunWaitInput.fields.timeoutSeconds),
  }),
  success: SystemsRun,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const RunGetTool = Tool.make("t3_systems_run_get", {
  ...shared,
  description: "A run's status, progress, digests and diagnostics.",
  parameters: SystemsRunRef,
  success: SystemsRun,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const RunListTool = Tool.make("t3_systems_run_list", {
  ...shared,
  description: `A project's latest runs, newest first: ${SYSTEMS_TOOL_DEFAULTS.runs} by default, at most ${SYSTEMS_RUN_LIST_MAX}.`,
  parameters: SystemsRunListInput,
  success: SystemsRunListResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const RunCancelTool = Tool.make("t3_systems_run_cancel", {
  ...shared,
  description:
    "Cancel a run. A running one stops between chunks and keeps what it committed. Idempotent per key.",
  parameters: SystemsRunCancelInput,
  success: SystemsRun,
}).annotate(Tool.Destructive, false);

const RunEventsTool = Tool.make("t3_systems_run_events", {
  ...shared,
  description: `One page of a run's trace from fromSequence (default "0"); limit defaults to ${SYSTEMS_TOOL_DEFAULTS.events}, max ${SYSTEMS_EVENTS_PAGE_MAX}. While hasMore, pass nextSequence back.`,
  parameters: Schema.Struct({
    ...SystemsRunRef.fields,
    fromSequence: Schema.optionalKey(SystemsRunEventsInput.fields.fromSequence),
    limit: Schema.optionalKey(SystemsRunEventsInput.fields.limit),
  }),
  success: SystemsRunEventsResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const RunSignalsTool = Tool.make("t3_systems_run_signals", {
  ...shared,
  description: `Probe samples for up to 16 signals over an optional time range, at most maxPoints each (default ${SYSTEMS_TOOL_DEFAULTS.signalPoints}, max ${SYSTEMS_SIGNAL_POINTS_MAX}). Above that, each interval keeps its minimum and maximum.`,
  parameters: Schema.Struct({
    ...SystemsRunSignalsInput.fields,
    maxPoints: Schema.optionalKey(SystemsRunSignalsInput.fields.maxPoints),
  }),
  success: SystemsRunSignalsResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const RunCompareTool = Tool.make("t3_systems_run_compare", {
  ...shared,
  description: "Compare a finished run with the expected trace that names its experiment.",
  parameters: SystemsRunCompareInput,
  success: SystemsRunCompareResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

const ConformanceTool = Tool.make("t3_systems_conformance_execute", {
  ...shared,
  description:
    "Execute conformance fixtures, the shipped RFC-001 pack or a project's manifest, and report each one.",
  parameters: SystemsConformanceInput,
  success: SystemsConformanceResult,
}).annotate(Tool.Destructive, false);

const CapabilitiesTool = Tool.make("t3_systems_capabilities", {
  ...shared,
  description:
    "The local runner's protocol, solvers and blocks, and the systems capabilities you hold in projectId (default: your thread's project).",
  parameters: Schema.Struct({ projectId: Schema.optionalKey(ProjectId) }),
  success: SystemsCapabilitiesResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false);

export const SystemsToolkit = Toolkit.make(
  ValidateTool,
  CompileTool,
  SemanticDiffTool,
  ModelReadTool,
  ModelPatchTool,
  RunCreateTool,
  RunWaitTool,
  RunGetTool,
  RunListTool,
  RunCancelTool,
  RunEventsTool,
  RunSignalsTool,
  RunCompareTool,
  ConformanceTool,
  CapabilitiesTool,
);
