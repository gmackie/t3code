import { bobOperationSchemas, BobExecutionAdmission } from "@t3tools/contracts/bobContract";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- receipt ids are synchronous sha256 digests of request ids.
import * as NodeCrypto from "node:crypto";
import { ThreadId } from "@t3tools/contracts";
import {
  BobCoordinationError,
  type RecordExecutionReceiptInput,
} from "@t3tools/contracts/bobCoordination";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import { HttpClient, HttpClientRequest } from "effect/http";
import * as Bob from "./BobCoordination.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as ServerConfig from "../config.ts";

interface Row {
  readonly request_id: string;
  readonly admission_json: string;
  readonly run_id: string;
}
interface Outbox {
  readonly request_id: string;
  readonly payload_json: string;
}
export class ExecutionReceipts extends Context.Service<
  ExecutionReceipts,
  { readonly flush: Effect.Effect<void, BobCoordinationError> }
>()("t3/coordination/ExecutionReceipts") {}
export const make = (startWorkers = true) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const threads = yield* ThreadManagement.ThreadManagementService;
    const process = yield* ProcessRunner.ProcessRunner;
    const fs = yield* FileSystem.FileSystem;
    const server = yield* ServerConfig.ServerConfig;
    const config = yield* Bob.BobConfiguration;
    const http = yield* HttpClient.HttpClient;
    const mutex = yield* Semaphore.make(1);
    const receiptSchema = bobOperationSchemas.get("RecordExecutionReceipt")!;
    const unavailable = () =>
      new BobCoordinationError({
        code: "ReceiptPending",
        status: 503,
        message: "Execution evidence is pending reconciliation.",
      });
    const git = (cwd: string, args: ReadonlyArray<string>) =>
      process
        .run({
          command: "git",
          args: ["--no-optional-locks", ...args],
          cwd,
          timeout: "15 seconds",
          maxOutputBytes: 4096,
        })
        .pipe(
          Effect.flatMap((result) =>
            result.code === 0 && !result.stdoutTruncated
              ? Effect.succeed(result.stdout.trim())
              : Effect.fail(unavailable()),
          ),
        );
    const capture = Effect.fn("ExecutionReceipts.capture")(function* (row: Row) {
      const admission = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(BobExecutionAdmission),
      )(row.admission_json);
      const projection = yield* threads.getThreadRecords(ThreadId.make(admission.thread.threadId), [
        "runs",
        "checkpoints",
        "checkpointScopes",
      ]);
      const run = projection.runs.find((run) => run.id === row.run_id);
      if (!run || !run.completedAt || !["completed", "failed", "cancelled"].includes(run.status))
        return;
      const checkpoint = projection.checkpoints.find(
        (checkpoint) =>
          checkpoint.runId === run.id &&
          checkpoint.status === "ready" &&
          projection.checkpointScopes.some(
            (scope) => scope.id === checkpoint.scopeId && scope.kind === "root_run",
          ),
      );
      // Never substitute the current working tree for the immutable terminal checkpoint.
      if (!checkpoint) return;
      const scope = projection.checkpointScopes.find((scope) => scope.id === checkpoint.scopeId)!;
      const commitSha = yield* git(scope.cwd, [
        "rev-parse",
        "--verify",
        `${checkpoint.ref}^{commit}`,
      ]);
      const treeOid = yield* git(scope.cwd, ["rev-parse", "--verify", `${commitSha}^{tree}`]);
      if (!/^[a-f0-9]{40}$/.test(commitSha) || !/^[a-f0-9]{40}$/.test(treeOid))
        return yield* unavailable();
      const treeDigest = NodeCrypto.createHash("sha256")
        .update(`git-tree:${treeOid}`)
        .digest("hex");
      const evidenceId = NodeCrypto.createHash("sha256").update(row.request_id).digest("hex");
      const receipt: RecordExecutionReceiptInput = {
        contractVersion: "1",
        eventId: `bob-terminal-${NodeCrypto.createHash("sha256").update(row.request_id).digest("hex")}`,
        environmentId: admission.target.environmentId,
        executionId: admission.executionId,
        attemptId: admission.attemptId,
        sequence: 1,
        occurredAt: DateTime.formatIso(run.completedAt),
        outcome:
          run.status === "completed"
            ? "succeeded"
            : run.status === "failed"
              ? "failed"
              : "cancelled",
        thread: admission.thread,
        sourceSnapshot: {
          repository: admission.target.repository,
          commitSha,
          treeDigest,
          dirty: false,
        },
        evidenceRefs: [`t3-checkpoint:${evidenceId}`],
      };
      const payloadJson = yield* Schema.encodeUnknownEffect(
        Schema.fromJsonString(receiptSchema.input),
      )(receipt);
      // The checkpoint is a Git commit, including any captured worktree changes.
      // Preserve it locally before recording a receipt; it is not PR-head evidence.
      const directory = `${server.stateDir}/bob-evidence`;
      yield* fs.makeDirectory(directory, { recursive: true });
      const bundlePath = `${directory}/${NodeCrypto.createHash("sha256").update(row.request_id).digest("hex")}.bundle`;
      if (!(yield* fs.exists(bundlePath))) {
        const temporaryPath = `${bundlePath}.tmp`;
        yield* fs.remove(temporaryPath, { force: true });
        const result = yield* process.run({
          command: "git",
          args: ["bundle", "create", temporaryPath, checkpoint.ref],
          cwd: scope.cwd,
          timeout: "30 seconds",
          maxOutputBytes: 4096,
        });
        if (result.code !== 0) return yield* unavailable();
        const heads = yield* git(scope.cwd, ["bundle", "list-heads", temporaryPath]);
        if (!heads.startsWith(`${commitSha} `)) return yield* unavailable();
        yield* fs.rename(temporaryPath, bundlePath);
      }
      // A crash may leave a bundle before its outbox row. Verify that existing
      // evidence still matches the checkpoint before recording the receipt.
      const preservedHeads = yield* git(scope.cwd, ["bundle", "list-heads", bundlePath]);
      if (!preservedHeads.split("\n").some((head) => head.startsWith(`${commitSha} `)))
        return yield* unavailable();
      yield* sql`INSERT OR IGNORE INTO bob_execution_receipts (request_id,payload_json) VALUES (${row.request_id},${payloadJson})`;
    });
    const reconcile = (runId: string | null = null) =>
      Effect.gen(function* () {
        const settings = yield* config.read;
        if (!settings.receiptCoordinator) return;
        const rows =
          yield* sql<Row>`SELECT a.request_id,a.admission_json,a.run_id FROM bob_execution_admissions a LEFT JOIN bob_execution_receipts r ON a.request_id=r.request_id WHERE a.launched=1 AND a.run_id IS NOT NULL AND r.request_id IS NULL AND (${runId} IS NULL OR a.run_id=${runId})`;
        yield* Effect.forEach(
          rows,
          (row) =>
            capture(row).pipe(
              Effect.catch(() =>
                Effect.logWarning(
                  "Bob terminal checkpoint is not yet available for reconciliation.",
                ),
              ),
            ),
          { discard: true },
        );
        const pending =
          yield* sql<Outbox>`SELECT request_id,payload_json FROM bob_execution_receipts WHERE delivered=0`;
        yield* Effect.forEach(
          pending,
          (row) =>
            Effect.gen(function* () {
              const payload = yield* Schema.decodeUnknownEffect(
                Schema.fromJsonString(receiptSchema.input),
              )(row.payload_json);
              const base = yield* Effect.try(() => new URL(settings.receiptCoordinator!.baseUrl));
              if (base.username || base.password || !["http:", "https:"].includes(base.protocol))
                return yield* unavailable();
              const response = yield* HttpClientRequest.post(
                new URL(receiptSchema.path, base).toString(),
              ).pipe(
                HttpClientRequest.setHeader(
                  "authorization",
                  `Bearer ${settings.receiptCoordinator!.authToken}`,
                ),
                HttpClientRequest.bodyJson(payload),
                Effect.flatMap(http.execute),
              );
              if (response.status !== 200) return yield* unavailable();
              const ack = (yield* Schema.decodeUnknownEffect(receiptSchema.output)(
                yield* response.json,
              )) as { eventId: string; acceptedSequence: number };
              const receipt = payload as RecordExecutionReceiptInput;
              if (ack.eventId !== receipt.eventId || ack.acceptedSequence !== receipt.sequence)
                return yield* unavailable();
              yield* sql`UPDATE bob_execution_receipts SET delivered=1 WHERE request_id=${row.request_id}`;
            }).pipe(
              Effect.timeout("15 seconds"),
              Effect.catch(() =>
                Effect.logWarning("Bob terminal receipt remains in the durable outbox."),
              ),
            ),
          { discard: true },
        );
      }).pipe(Effect.mapError(unavailable));
    const safeFlush = (runId: string | null = null) =>
      mutex
        .withPermits(1)(reconcile(runId))
        .pipe(Effect.catch(() => Effect.logWarning("Bob receipt reconciliation is pending.")));
    // Subscribe before the initial sweep so terminal/checkpoint events cannot be lost.
    if (startWorkers) {
      yield* Effect.forkScoped(
        threads.streamDomainEvents.pipe(
          Stream.filter(
            (event) => event.type === "run.updated" || event.type === "checkpoint.captured",
          ),
          Stream.runForEach((event) =>
            safeFlush(event.type === "run.updated" ? event.payload.id : event.payload.runId),
          ),
          Effect.catch(() =>
            Effect.logWarning(
              "Bob receipt event subscription stopped; outbox retries remain active.",
            ),
          ),
        ),
      );
      yield* Effect.forkScoped(safeFlush().pipe(Effect.repeat(Schedule.spaced("30 seconds"))));
    }
    return ExecutionReceipts.of({ flush: mutex.withPermits(1)(reconcile()) });
  });
export const layer = Layer.effect(ExecutionReceipts, make());
