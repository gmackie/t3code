import {
  BobExecutionRequest,
  BobExecutionAdmission,
  BobFindExecution,
} from "@t3tools/contracts/bobContract";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Bob ids are synchronous sha256 digests and UUIDs computed inside row mapping.
import * as NodeCrypto from "node:crypto";
import {
  CommandId,
  ProjectId,
  ThreadId,
  OrchestrationV2ThreadLaunchInput,
} from "@t3tools/contracts";
import {
  BobCoordinationError,
  type SubmitExecutionInput,
  type SubmitExecutionOutput,
  type GetCapabilitiesOutput,
} from "@t3tools/contracts/bobCoordination";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as BobCoordination from "./BobCoordination.ts";

const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, entry: unknown) =>
    entry !== null && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)))
      : entry,
  );
interface AdmissionRow {
  readonly request_id: string;
  readonly owner: string;
  readonly request_json: string;
  readonly launch_json: string;
  readonly admission_json: string;
  readonly launched: number;
}
const conflict = () =>
  new BobCoordinationError({
    code: "IdempotencyConflict",
    status: 409,
    message: "Request or attempt identifier already has a different immutable payload.",
  });
export class ExecutionAdmission extends Context.Service<
  ExecutionAdmission,
  {
    readonly submit: (
      owner: string,
      input: unknown,
      key: string | undefined,
    ) => Effect.Effect<SubmitExecutionOutput, BobCoordinationError>;
    readonly find: (
      owner: string,
      input: unknown,
    ) => Effect.Effect<SubmitExecutionOutput, BobCoordinationError>;
    readonly capabilities: Effect.Effect<GetCapabilitiesOutput, BobCoordinationError>;
  }
>()("t3/coordination/ExecutionAdmission") {}
const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const configuration = yield* BobCoordination.BobConfiguration;
  const environment = yield* ServerEnvironment.ServerEnvironmentIdentity;
  const launcher = yield* ThreadLaunchService.ThreadLaunchService;
  const mutex = yield* Semaphore.make(1);
  const storageError = () =>
    new BobCoordinationError({
      code: "StorageUnavailable",
      status: 503,
      message:
        "Execution admission could not be confirmed. Retry with the same request identifier.",
    });
  const policy = Effect.fn("ExecutionAdmission.policy")(function* (request: SubmitExecutionInput) {
    const config = yield* configuration.read;
    const environmentId = yield* environment.getEnvironmentId;
    const binding = config.projects[request.target.projectId];
    if (
      request.target.environmentId !== environmentId ||
      !binding ||
      canonical(binding.target) !== canonical(request.target)
    )
      return yield* new BobCoordinationError({
        code: "TargetMismatch",
        status: 409,
        message: "Execution target is not configured in this environment.",
      });
    const profile = config.executionProfiles[request.executionProfileId];
    if (!profile)
      return yield* new BobCoordinationError({
        code: "CapabilityUnavailable",
        status: 501,
        message: "Execution profile is not configured in this environment.",
      });
    return profile;
  });
  const recover = Effect.fn("ExecutionAdmission.recover")(function* (row: AdmissionRow) {
    const request = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(BobExecutionRequest))(
      row.request_json,
    ).pipe(Effect.mapError(storageError));
    if (!row.launched) {
      // The full launch (including the environment-local model selection) was
      // pinned before side effects. ThreadLaunchService replays its own durable
      // create/message receipts using these same IDs after any interruption.
      const launch = yield* Schema.decodeEffect(
        Schema.fromJsonString(OrchestrationV2ThreadLaunchInput),
      )(row.launch_json).pipe(Effect.mapError(storageError));
      if (!launch.threadId || !launch.initialMessage) return yield* storageError();
      const result = yield* launcher
        .launch({
          commandId: launch.commandId,
          threadId: launch.threadId,
          projectId: launch.projectId,
          title: launch.title,
          modelSelection: launch.modelSelection,
          runtimeMode: launch.runtimeMode,
          interactionMode: launch.interactionMode,
          createdBy: "system",
          creationSource: "server",
          workspaceStrategy: {
            type: "worktree",
            baseRef: request.workspace.baseRevision,
            branch: request.workspace.branch,
            startFromOrigin: false,
          },
          initialMessage: { text: launch.initialMessage.text, attachments: [] },
        })
        .pipe(
          Effect.mapError(
            () =>
              new BobCoordinationError({
                code: "ExecutionUnknown",
                status: 503,
                message:
                  "Admission is durable but thread launch is not yet confirmed. Find the same request before retrying.",
              }),
          ),
        );
      yield* sql`UPDATE bob_execution_admissions SET launched=1,run_id=${result.projection.runs.find((run) => run.ordinal === 1)?.id ?? null} WHERE request_id=${row.request_id}`.pipe(
        Effect.mapError(storageError),
      );
    }
    return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(BobExecutionAdmission))(
      row.admission_json,
    ).pipe(Effect.mapError(storageError));
  });
  const submit = Effect.fn("ExecutionAdmission.submit")(function* (
    owner: string,
    raw: unknown,
    key: string | undefined,
  ) {
    const request = yield* Schema.decodeUnknownEffect(BobExecutionRequest, {
      onExcessProperty: "error",
    })(raw).pipe(
      Effect.mapError(
        () =>
          new BobCoordinationError({
            code: "InvalidRequest",
            status: 400,
            message: "Execution request does not match the ForgeC contract.",
          }),
      ),
    );
    if (request.requestId !== key)
      return yield* new BobCoordinationError({
        code: "InvalidRequest",
        status: 400,
        message: "Idempotency-Key must equal requestId.",
      });
    const profile = yield* policy(request);
    const row = yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const existing =
            yield* sql<AdmissionRow>`SELECT * FROM bob_execution_admissions WHERE request_id=${request.requestId}`;
          if (existing[0]) {
            if (existing[0].owner !== owner || existing[0].request_json !== canonical(request))
              return yield* conflict();
            return existing[0];
          }
          const attempts =
            yield* sql`SELECT request_id FROM bob_execution_admissions WHERE attempt_id=${request.attemptId}`;
          if (attempts.length) return yield* conflict();
          const threadId = ThreadId.make(NodeCrypto.randomUUID());
          const commandId = CommandId.make(
            `bob-${NodeCrypto.createHash("sha256")
              .update(canonical([owner, request.requestId]))
              .digest("hex")}`,
          );
          const admission: SubmitExecutionOutput = {
            contractVersion: "1",
            requestId: request.requestId,
            attemptId: request.attemptId,
            executionId: NodeCrypto.randomUUID(),
            target: request.target,
            thread: {
              environmentId: request.target.environmentId,
              projectId: request.target.projectId,
              threadId,
            },
          };
          const launch: ThreadLaunchService.ThreadLaunchInput = {
            commandId,
            threadId,
            projectId: ProjectId.make(request.target.projectId),
            title: request.work.title,
            modelSelection: profile.modelSelection,
            runtimeMode: profile.runtimeMode,
            interactionMode: "default",
            createdBy: "system",
            creationSource: "server",
            workspaceStrategy: {
              type: "worktree",
              baseRef: request.workspace.baseRevision,
              branch: request.workspace.branch,
              startFromOrigin: false,
            },
            initialMessage: {
              text: `${request.work.title}\n\n${request.work.instructions}\n\nAcceptance criteria:\n${request.work.acceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n")}`,
              attachments: [],
            },
          };
          const launchJson = yield* Schema.encodeEffect(
            Schema.fromJsonString(OrchestrationV2ThreadLaunchInput),
          )(launch);
          const admissionJson = yield* Schema.encodeEffect(
            Schema.fromJsonString(BobExecutionAdmission),
          )(admission);
          const stored: AdmissionRow = {
            request_id: request.requestId,
            owner,
            request_json: canonical(request),
            launch_json: launchJson,
            admission_json: admissionJson,
            launched: 0,
          };
          yield* sql`INSERT INTO bob_execution_admissions (request_id,attempt_id,owner,request_json,launch_json,admission_json) VALUES (${request.requestId},${request.attemptId},${owner},${stored.request_json},${stored.launch_json},${stored.admission_json})`;
          return stored;
        }),
      )
      .pipe(
        Effect.mapError((error) =>
          Schema.is(BobCoordinationError)(error) ? error : storageError(),
        ),
      );
    return yield* recover(row);
  });
  const find = Effect.fn("ExecutionAdmission.find")(function* (owner: string, raw: unknown) {
    const input = yield* Schema.decodeUnknownEffect(BobFindExecution, {
      onExcessProperty: "error",
    })(raw).pipe(
      Effect.mapError(
        () =>
          new BobCoordinationError({
            code: "InvalidRequest",
            status: 400,
            message: "Invalid execution lookup.",
          }),
      ),
    );
    if (input.environmentId !== (yield* environment.getEnvironmentId))
      return yield* new BobCoordinationError({
        code: "TargetMismatch",
        status: 409,
        message: "Lookup names another environment.",
      });
    const rows =
      yield* sql<AdmissionRow>`SELECT * FROM bob_execution_admissions WHERE request_id=${input.requestId} AND owner=${owner}`.pipe(
        Effect.mapError(storageError),
      );
    if (!rows[0])
      return yield* new BobCoordinationError({
        code: "NotFound",
        status: 404,
        message: "Execution request not found.",
      });
    return yield* recover(rows[0]);
  });
  const pendingRecovery =
    sql<AdmissionRow>`SELECT * FROM bob_execution_admissions WHERE launched=0`.pipe(
      Effect.flatMap((rows) =>
        Effect.forEach(
          rows,
          (row) =>
            mutex
              .withPermits(1)(recover(row))
              .pipe(
                Effect.catch(() =>
                  Effect.logWarning(
                    "Bob execution remains pending; retry lookup to recover admission.",
                  ),
                ),
              ),
          { discard: true },
        ),
      ),
      Effect.catch(() =>
        Effect.logWarning("Bob execution recovery could not read pending admissions."),
      ),
    );
  yield* Effect.forkScoped(pendingRecovery);
  return ExecutionAdmission.of({
    submit: (owner, input, key) => mutex.withPermits(1)(submit(owner, input, key)),
    find: (owner, input) => mutex.withPermits(1)(find(owner, input)),
    capabilities: configuration.read.pipe(
      Effect.map((config) => ({
        contractVersion: "1",
        operations: ["SubmitExecution", "FindExecution", "GetCapabilities"],
        executionProfiles: Object.keys(config.executionProfiles),
        validationProfiles: [],
        eventResume: false,
        durableExecutionAdmission: true,
      })),
    ),
  });
});
export const layer = Layer.effect(ExecutionAdmission, make);
