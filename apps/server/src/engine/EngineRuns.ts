import {
  EngineEventId,
  EngineIdempotencyConflict,
  EngineNotFound,
  EngineRevisionConflict,
  RunId,
  type EngineName,
  type PrincipalRef,
  type RunSpec,
  type RunStatus,
  type RunView,
} from "@t3tools/engine/contracts";
import {
  RunEventBody,
  applyRunEvent,
  decideRun,
  type RunCommand,
  type RunCommandRejected,
} from "@t3tools/engine/runs";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- run ids are synchronous sha256 digests of (tenant, idempotency key).
import * as NodeCrypto from "node:crypto";

import type { PersistenceSqlError } from "../persistence/Errors.ts";
import { EngineJournal, type EngineCommitTooLarge } from "./EngineJournal.ts";

export type EngineRunsError =
  | RunCommandRejected
  | EngineNotFound
  | EngineRevisionConflict
  | EngineIdempotencyConflict
  | EngineCommitTooLarge
  | PersistenceSqlError;

/**
 * Run commands and reads. Every method takes the authenticated caller and
 * binds the tenant from it; a run in another tenant reads as not found.
 */
export interface EngineRunsShape {
  /** Idempotent per (tenant, spec.idempotencyKey): a repeat returns the same run. */
  readonly create: (caller: PrincipalRef, spec: RunSpec) => Effect.Effect<RunView, EngineRunsError>;
  readonly get: (
    caller: PrincipalRef,
    runId: RunId,
  ) => Effect.Effect<RunView, EngineNotFound | PersistenceSqlError>;
  readonly cancel: (input: {
    readonly caller: PrincipalRef;
    readonly runId: RunId;
    readonly idempotencyKey: string;
  }) => Effect.Effect<RunView, EngineRunsError>;
  /** Lifecycle moves made by executors and the coordinator. */
  readonly transition: (input: {
    readonly caller: PrincipalRef;
    readonly runId: RunId;
    readonly to: RunStatus;
    readonly errorCode?: EngineName;
    readonly idempotencyKey: string;
  }) => Effect.Effect<RunView, EngineRunsError>;
}

export class EngineRuns extends Context.Service<EngineRuns, EngineRunsShape>()(
  "t3/engine/EngineRuns",
) {}

const RUN_PAGE = 200;
const decodeRunId = Schema.decodeSync(RunId);
const decodeEventId = Schema.decodeSync(EngineEventId);
const decodeBody = Schema.decodeUnknownEffect(RunEventBody);

const runStream = (runId: RunId) => `run:${runId}`;

/** Deterministic, so a retried create resolves to the same run. */
const deriveRunId = (caller: PrincipalRef, idempotencyKey: string) =>
  decodeRunId(
    `run-${NodeCrypto.createHash("sha256")
      .update(`${caller.tenantId}\u0000${idempotencyKey}`)
      .digest("hex")
      .slice(0, 32)}`,
  );

const make = Effect.gen(function* () {
  const journal = yield* EngineJournal;

  const load = Effect.fn("EngineRuns.load")(function* (caller: PrincipalRef, runId: RunId) {
    let view: RunView | undefined;
    let version = 0;
    while (true) {
      const page = yield* journal.read({
        tenantId: caller.tenantId,
        streamId: runStream(runId),
        afterVersion: version,
        limit: RUN_PAGE,
      });
      for (const event of page) {
        const body = yield* decodeBody({ type: event.type, payload: event.payload }).pipe(
          Effect.orDie,
        );
        view = applyRunEvent(view, body, event.occurredAt);
        version = event.streamVersion;
      }
      if (page.length < RUN_PAGE) return { view, version };
    }
  });

  const get: EngineRunsShape["get"] = (caller, runId) =>
    load(caller, runId).pipe(
      Effect.flatMap(({ view }) =>
        view === undefined
          ? Effect.fail(new EngineNotFound({ kind: "run", id: runId }))
          : Effect.succeed(view),
      ),
    );

  const execute = Effect.fn("EngineRuns.execute")(function* (input: {
    readonly caller: PrincipalRef;
    readonly runId: RunId;
    readonly command: RunCommand;
    readonly idempotencyKey: string;
  }) {
    const committed = yield* journal.findReceipt({
      tenantId: input.caller.tenantId,
      idempotencyKey: input.idempotencyKey,
    });
    if (Option.isSome(committed)) {
      // A retry of a command that already landed returns the run as it is now.
      if (
        committed.value.streamId !== runStream(input.runId) ||
        committed.value.commandType !== input.command.type
      ) {
        return yield* new EngineIdempotencyConflict({ idempotencyKey: input.idempotencyKey });
      }
      return yield* get(input.caller, input.runId);
    }
    const { view, version } = yield* load(input.caller, input.runId);
    const events = yield* Result.match(decideRun(view, input.command), {
      onSuccess: Effect.succeed,
      onFailure: Effect.fail,
    });
    const occurredAt = DateTime.formatIso(yield* DateTime.now);
    yield* journal.commit({
      tenantId: input.caller.tenantId,
      streamId: runStream(input.runId),
      expectedVersion: version,
      idempotencyKey: input.idempotencyKey,
      commandType: input.command.type,
      events: events.map((event, index) => ({
        eventId: decodeEventId(`${input.runId}:${version + index + 1}`),
        type: event.type,
        runId: input.runId,
        actor: input.caller,
        occurredAt,
        payload: event.payload,
      })),
    });
    const after = yield* load(input.caller, input.runId);
    if (after.view === undefined) {
      return yield* new EngineNotFound({ kind: "run", id: input.runId });
    }
    return after.view;
  });

  const create: EngineRunsShape["create"] = (caller, spec) => {
    const runId = deriveRunId(caller, spec.idempotencyKey);
    return execute({
      caller,
      runId,
      idempotencyKey: `create:${spec.idempotencyKey}`,
      command: { type: "run.create", runId, tenantId: caller.tenantId, spec, createdBy: caller },
    }).pipe(
      // A retried create can reach the decider after the first one committed.
      Effect.catchTags({
        RunCommandRejected: (rejected) =>
          rejected.reason === "run-exists" ? get(caller, runId) : Effect.fail(rejected),
      }),
    );
  };

  const cancel: EngineRunsShape["cancel"] = ({ caller, runId, idempotencyKey }) =>
    execute({ caller, runId, idempotencyKey, command: { type: "run.cancel" } });

  const transition: EngineRunsShape["transition"] = ({
    caller,
    runId,
    to,
    errorCode,
    idempotencyKey,
  }) =>
    execute({
      caller,
      runId,
      idempotencyKey,
      command: { type: "run.transition", to, ...(errorCode === undefined ? {} : { errorCode }) },
    });

  return EngineRuns.of({ create, get, cancel, transition });
});

export const layer = Layer.effect(EngineRuns, make);
