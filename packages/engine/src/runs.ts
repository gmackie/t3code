import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import {
  EngineName,
  PrincipalRef,
  RunId,
  RunSpec,
  RunStatus,
  TenantId,
  type RunView,
} from "./contracts.ts";

/**
 * Run lifecycle as a pure decider. The server folds a run's stream with
 * `applyRunEvent`, asks `decideRun` what a command produces, and commits the
 * result at the version it read. Nothing here touches storage or time.
 */

/** §6.2 of the engine plan; every other move is rejected. */
export const RUN_TRANSITIONS: Readonly<Record<RunStatus, ReadonlyArray<RunStatus>>> = {
  created: ["queued"],
  queued: ["leased", "cancelled"],
  leased: ["running", "queued"],
  running: [
    "completed",
    "waiting-approval",
    "waiting-input",
    "waiting-event",
    "retry-scheduled",
    "suspended",
    "failed",
    "cancelled",
    "outcome-unknown",
  ],
  "waiting-approval": ["queued", "cancelled"],
  "waiting-input": ["queued"],
  "waiting-event": ["queued"],
  "retry-scheduled": ["queued"],
  suspended: ["queued"],
  "outcome-unknown": ["completed", "failed"],
  failed: ["queued"],
  completed: [],
  cancelled: [],
};

/** Statuses that end a run's current attempt; only `failed` can be re-queued. */
export const FINISHED_RUN_STATUSES: ReadonlyArray<RunStatus> = ["completed", "failed", "cancelled"];
export const isFinishedRunStatus = (status: RunStatus) => FINISHED_RUN_STATUSES.includes(status);

export const RunCreatedPayload = Schema.Struct({
  runId: RunId,
  tenantId: TenantId,
  spec: RunSpec,
  createdBy: PrincipalRef,
});
export type RunCreatedPayload = typeof RunCreatedPayload.Type;

export const RunStatusChangedPayload = Schema.Struct({
  from: RunStatus,
  to: RunStatus,
  errorCode: Schema.optionalKey(EngineName),
});
export type RunStatusChangedPayload = typeof RunStatusChangedPayload.Type;

export const RunEventBody = Schema.Union([
  Schema.Struct({ type: Schema.Literal("run.created"), payload: RunCreatedPayload }),
  Schema.Struct({ type: Schema.Literal("run.status-changed"), payload: RunStatusChangedPayload }),
]);
export type RunEventBody = typeof RunEventBody.Type;

export type RunCommand =
  | {
      readonly type: "run.create";
      readonly runId: RunId;
      readonly tenantId: TenantId;
      readonly spec: RunSpec;
      readonly createdBy: PrincipalRef;
    }
  | { readonly type: "run.transition"; readonly to: RunStatus; readonly errorCode?: EngineName }
  | { readonly type: "run.cancel" };

export class RunCommandRejected extends Schema.TaggedError<RunCommandRejected>()(
  "RunCommandRejected",
  {
    reason: Schema.Literals(["run-exists", "run-missing", "transition-not-allowed"]),
    from: Schema.optionalKey(RunStatus),
    to: Schema.optionalKey(RunStatus),
  },
) {}

/** Folds one event onto the run; `at` is the event's time. */
export const applyRunEvent = (
  view: RunView | undefined,
  event: RunEventBody,
  at: string,
): RunView | undefined => {
  switch (event.type) {
    case "run.created":
      return {
        runId: event.payload.runId,
        tenantId: event.payload.tenantId,
        status: "created",
        revision: 1,
        createdBy: event.payload.createdBy,
        spec: event.payload.spec,
        createdAt: at,
        updatedAt: at,
      };
    case "run.status-changed": {
      if (view === undefined) return view;
      const { errorCode } = event.payload;
      const { finishedAt: _previousFinish, ...rest } = view;
      return {
        ...rest,
        status: event.payload.to,
        revision: view.revision + 1,
        updatedAt: at,
        ...(isFinishedRunStatus(event.payload.to) ? { finishedAt: at } : {}),
        ...(errorCode === undefined ? {} : { lastErrorCode: errorCode }),
      };
    }
  }
};

const transition = (
  view: RunView,
  to: RunStatus,
  errorCode?: EngineName,
): Result.Result<ReadonlyArray<RunEventBody>, RunCommandRejected> =>
  RUN_TRANSITIONS[view.status].includes(to)
    ? Result.succeed([
        {
          type: "run.status-changed",
          payload: { from: view.status, to, ...(errorCode === undefined ? {} : { errorCode }) },
        },
      ])
    : Result.fail(
        new RunCommandRejected({ reason: "transition-not-allowed", from: view.status, to }),
      );

/** What `command` produces against the current run, or why it is refused. */
export const decideRun = (
  view: RunView | undefined,
  command: RunCommand,
): Result.Result<ReadonlyArray<RunEventBody>, RunCommandRejected> => {
  if (command.type === "run.create") {
    if (view !== undefined) return Result.fail(new RunCommandRejected({ reason: "run-exists" }));
    return Result.succeed([
      {
        type: "run.created",
        payload: {
          runId: command.runId,
          tenantId: command.tenantId,
          spec: command.spec,
          createdBy: command.createdBy,
        },
      },
      { type: "run.status-changed", payload: { from: "created", to: "queued" } },
    ]);
  }
  if (view === undefined) return Result.fail(new RunCommandRejected({ reason: "run-missing" }));
  return command.type === "run.cancel"
    ? transition(view, "cancelled")
    : transition(view, command.to, command.errorCode);
};
