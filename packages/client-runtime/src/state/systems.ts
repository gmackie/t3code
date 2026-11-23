import { AsyncResult, Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  WS_METHODS,
  type EnvironmentId,
  type ProjectId,
  type SystemsRunEventsInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { request } from "../rpc/client.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
  createEnvironmentQueryAtomFamily,
} from "./runtime.ts";

/** Systems Workbench operations; runs execute on the connected environment, never the client. */
export function createSystemsEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const runsLive = createEnvironmentRpcSubscriptionAtomFamily(runtime, {
    label: "systems:runs:live",
    tag: WS_METHODS.systemsRunsSubscribe,
  });
  const counters = Atom.family((key: string) => {
    const target = JSON.parse(key) as {
      environmentId: EnvironmentId;
      projectId: ProjectId;
      runId: string;
      kind: "eventCount" | "sampleCount";
    };
    return Atom.make((get) => {
      const snapshot = AsyncResult.getOrElse(
        get(
          runsLive({ environmentId: target.environmentId, input: { projectId: target.projectId } }),
        ),
        () => null,
      );
      return snapshot?.runs.find((run) => run.runId === target.runId)?.[target.kind] ?? 0;
    });
  });
  return {
    validate: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "systems:validate",
      tag: WS_METHODS.systemsValidate,
      staleTimeMs: 2_000,
    }),
    compile: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "systems:compile",
      tag: WS_METHODS.systemsCompile,
      staleTimeMs: 2_000,
    }),
    capabilities: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "systems:capabilities",
      tag: WS_METHODS.systemsTargetsCapabilities,
      staleTimeMs: 60_000,
    }),
    run: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "systems:run",
      tag: WS_METHODS.systemsRunsGet,
      staleTimeMs: 1_000,
    }),
    runs: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "systems:runs",
      tag: WS_METHODS.systemsRunsList,
      staleTimeMs: 1_000,
    }),
    runsLive,
    events: createEnvironmentQueryAtomFamily(runtime, {
      label: "systems:events",
      execute: (input: typeof SystemsRunEventsInput.Type) =>
        request(WS_METHODS.systemsRunsEvents, input).pipe(
          Effect.map((page) => ({ ...page, full: page.events.length >= input.limit })),
        ),
      staleTimeMs: 1_000,
      refreshTrigger: ({ environmentId, input }) =>
        counters(
          JSON.stringify({
            environmentId,
            projectId: input.projectId,
            runId: input.runId,
            kind: "eventCount",
          }),
        ),
      isFinal: (page) => page.full,
    }),
    signals: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "systems:signals",
      tag: WS_METHODS.systemsRunsSignals,
      staleTimeMs: 1_000,
      refreshTrigger: ({ environmentId, input }) =>
        counters(
          JSON.stringify({
            environmentId,
            projectId: input.projectId,
            runId: input.runId,
            kind: "sampleCount",
          }),
        ),
    }),
    compare: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "systems:compare",
      tag: WS_METHODS.systemsRunsCompare,
      staleTimeMs: 5_000,
    }),
    model: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "systems:model",
      tag: WS_METHODS.systemsModelsRead,
      staleTimeMs: 1_000,
    }),
    patchModel: createEnvironmentRpcCommand(runtime, {
      label: "systems:model-patch",
      tag: WS_METHODS.systemsModelsPatch,
    }),
    semanticDiff: createEnvironmentRpcCommand(runtime, {
      label: "systems:semantic-diff",
      tag: WS_METHODS.systemsSemanticDiff,
    }),
    createRun: createEnvironmentRpcCommand(runtime, {
      label: "systems:run-create",
      tag: WS_METHODS.systemsRunsCreate,
    }),
    cancelRun: createEnvironmentRpcCommand(runtime, {
      label: "systems:run-cancel",
      tag: WS_METHODS.systemsRunsCancel,
    }),
    conformance: createEnvironmentRpcCommand(runtime, {
      label: "systems:conformance",
      tag: WS_METHODS.systemsConformanceExecute,
    }),
  };
}
