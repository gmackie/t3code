import type { SystemsError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as SystemsService from "../../../systems/SystemsService.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { systemsAuthority } from "./authority.ts";
import { SYSTEMS_TOOL_DEFAULTS, SystemsToolkit } from "./tools.ts";

// SystemsError is part of each tool's failure, so codes and diagnostics reach the agent as is.
const call =
  <I, A, E = never, R = never>(
    method: (
      systems: SystemsService.SystemsService["Service"],
    ) => (input: I) => Effect.Effect<A, SystemsError | E, R>,
  ) =>
  (input: I) =>
    SystemsService.SystemsService.pipe(Effect.flatMap((systems) => method(systems)(input)));

// Simulation runs in an isolated worker and changes no files: a link may start it, as it may
// add a project. Cancelling changes a run that is not the link's.
export const layer = McpToolAccess.toLayer(SystemsToolkit, {
  t3_systems_validate: McpToolAccess.reads(call((systems) => systems.validate)),
  t3_systems_compile: McpToolAccess.reads(call((systems) => systems.compile)),
  t3_systems_semantic_diff: McpToolAccess.reads(call((systems) => systems.semanticDiff)),
  t3_systems_model_read: McpToolAccess.reads(call((systems) => systems.readModel)),
  // Declared as a read so a caller without model.edit gets E-AUTH-001 and may still dry-run.
  t3_systems_model_patch: McpToolAccess.reads(
    call(
      (systems) => (input) =>
        Effect.flatMap(systemsAuthority(input.projectId), (authority) =>
          systems.patchModel(input, authority),
        ),
    ),
  ),
  t3_systems_run_create: McpToolAccess.writes(
    call((systems) => systems.createRun),
    { linkedCallers: "allowed" },
  ),
  t3_systems_run_wait: McpToolAccess.reads(
    call(
      (systems) => (input) =>
        systems.waitForRun({
          ...input,
          timeoutSeconds: input.timeoutSeconds ?? SYSTEMS_TOOL_DEFAULTS.waitSeconds,
        }),
    ),
  ),
  t3_systems_run_get: McpToolAccess.reads(call((systems) => systems.getRun)),
  t3_systems_run_list: McpToolAccess.reads(
    call(
      (systems) => (input) =>
        systems.listRuns({ ...input, limit: input.limit ?? SYSTEMS_TOOL_DEFAULTS.runs }),
    ),
  ),
  t3_systems_run_cancel: McpToolAccess.writes(call((systems) => systems.cancelRun)),
  t3_systems_run_events: McpToolAccess.reads(
    call(
      (systems) => (input) =>
        systems.runEvents({
          ...input,
          fromSequence: input.fromSequence ?? "0",
          limit: input.limit ?? SYSTEMS_TOOL_DEFAULTS.events,
        }),
    ),
  ),
  t3_systems_run_signals: McpToolAccess.reads(
    call(
      (systems) => (input) =>
        systems.runSignals({
          ...input,
          maxPoints: input.maxPoints ?? SYSTEMS_TOOL_DEFAULTS.signalPoints,
        }),
    ),
  ),
  t3_systems_run_compare: McpToolAccess.reads(call((systems) => systems.compareRun)),
  t3_systems_conformance_execute: McpToolAccess.writes(
    call((systems) => systems.executeConformance),
    { linkedCallers: "allowed" },
  ),
  t3_systems_capabilities: McpToolAccess.reads(
    call(
      (systems) => (input) =>
        Effect.flatMap(systemsAuthority(input.projectId), (authority) =>
          systems.capabilities(authority),
        ),
    ),
  ),
});
