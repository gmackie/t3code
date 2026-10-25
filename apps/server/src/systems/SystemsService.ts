/**
 * SystemsService - RFC-001 Systems Workbench for the projects of this environment. Owns model
 * loading, compilation, the run queue, the simulation workers and run storage; the `systems.*`
 * WebSocket RPCs (and later MCP tools) call it. Runs are environment-owned and immutable: a
 * connection closing never cancels one, and a restart fails what was running.
 */
import * as NodeWorkerThreads from "node:worker_threads";
import {
  type ProjectId,
  SystemsError,
  type SystemsCapabilitiesResult,
  type SystemsCompileInput,
  type SystemsCompileResult,
  type SystemsCompiledEntry,
  type SystemsConformanceInput,
  type SystemsConformanceResult,
  type SystemsProjectInput,
  SystemsRun,
  type SystemsRunCancelInput,
  type SystemsRunCompareInput,
  type SystemsRunCompareResult,
  type SystemsRunCreateInput,
  type SystemsRunEventsInput,
  type SystemsRunEventsResult,
  type SystemsRunListInput,
  type SystemsRunListResult,
  type SystemsRunRef,
  type SystemsRunSignalsInput,
  type SystemsRunSignalsResult,
  type SystemsSemanticDiffInput,
  type SystemsSemanticDiffResult,
  type SystemsSignalPoint,
  type SystemsValidateInput,
  type SystemsValidateResult,
} from "@t3tools/contracts";
import {
  COMPILER_VERSION,
  compileChart,
  compileSystem,
  type ResolvedChart,
  type ResolvedSystem,
} from "@t3tools/systems-compiler/compile";
import { semanticDiff as diffDocuments } from "@t3tools/systems-compiler/diff";
import { canonicalize, digest, parseStrictJson } from "@t3tools/systems-compiler/json";
import { semanticNormalize } from "@t3tools/systems-compiler/normalize";
import {
  hasErrors,
  sortDiagnostics,
  type ModelDiagnostic,
} from "@t3tools/systems-model/diagnostics";
import { RunDocument } from "@t3tools/systems-model/documents";
import {
  diagnosticsFor,
  readPackFiles,
  readReferencedFiles,
  validatePack,
  type PackFiles,
  type ParseJson,
} from "@t3tools/systems-model/pack";
import { toNumber } from "@t3tools/systems-model/rational";
import { SignalSample, TraceEvent } from "@t3tools/systems-model/trace";
import { isNormalizedPath } from "@t3tools/systems-model/validate";
import { capabilities as runnerCapabilities } from "@t3tools/systems-runtime/capabilities";
import { compareToExpected } from "@t3tools/systems-runtime/compare";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FiberSet from "effect/FiberSet";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";

import * as ProjectService from "../project/ProjectService.ts";
import { runSystemsMigrations } from "./SystemsMigrations.ts";
import {
  commandInbox,
  conformanceOf,
  driveRun,
  type FromWorker,
  type RunJob,
  type ToWorker,
  type WorkerJob,
} from "./SystemsWorkerProtocol.ts";

export class SystemsService extends Context.Service<
  SystemsService,
  {
    readonly validate: (
      input: typeof SystemsValidateInput.Type,
    ) => Effect.Effect<SystemsValidateResult, SystemsError>;
    readonly compile: (
      input: typeof SystemsCompileInput.Type,
    ) => Effect.Effect<SystemsCompileResult, SystemsError>;
    readonly semanticDiff: (
      input: typeof SystemsSemanticDiffInput.Type,
    ) => Effect.Effect<SystemsSemanticDiffResult, SystemsError>;
    /** Queues a run; the same idempotency key in the same project returns the first run. */
    readonly createRun: (
      input: typeof SystemsRunCreateInput.Type,
    ) => Effect.Effect<SystemsRun, SystemsError>;
    readonly getRun: (input: SystemsRunRef) => Effect.Effect<SystemsRun, SystemsError>;
    readonly listRuns: (
      input: typeof SystemsRunListInput.Type,
    ) => Effect.Effect<SystemsRunListResult, SystemsError>;
    /** The run list now, then again after each status or progress change in the project. */
    readonly subscribeRuns: (
      input: typeof SystemsRunListInput.Type,
    ) => Stream.Stream<SystemsRunListResult, SystemsError>;
    /** A queued run is cancelled at once; a running one between chunks. */
    readonly cancelRun: (
      input: typeof SystemsRunCancelInput.Type,
    ) => Effect.Effect<SystemsRun, SystemsError>;
    /** Completes once the run is completed, failed or cancelled. */
    readonly awaitRun: (input: SystemsRunRef) => Effect.Effect<SystemsRun, SystemsError>;
    readonly runEvents: (
      input: typeof SystemsRunEventsInput.Type,
    ) => Effect.Effect<SystemsRunEventsResult, SystemsError>;
    readonly runSignals: (
      input: typeof SystemsRunSignalsInput.Type,
    ) => Effect.Effect<SystemsRunSignalsResult, SystemsError>;
    readonly compareRun: (
      input: typeof SystemsRunCompareInput.Type,
    ) => Effect.Effect<SystemsRunCompareResult, SystemsError>;
    readonly executeConformance: (
      input: typeof SystemsConformanceInput.Type,
    ) => Effect.Effect<SystemsConformanceResult, SystemsError>;
    readonly capabilities: () => Effect.Effect<SystemsCapabilitiesResult>;
  }
>()("t3/systems/SystemsService") {}

export interface SystemsServiceOptions {
  /** Runs executing at once; the rest wait in creation order. */
  readonly maxConcurrentRuns?: number;
  /** Boundaries a worker steps before it waits for the host to commit. */
  readonly chunkBoundaries?: number;
}

const PROJECT_FILE = "systems.project.json";
const RUN_LIST_LIMIT = 100;
const INSERT_BATCH = 200;
const LISTED_FILES_LIMIT = 200;
/** A comparison loads the whole run; beyond this it is refused rather than paged. */
const COMPARE_ROWS_LIMIT = 250_000;
const PROGRESS_PUBLISH_MS = 250;
const EXPECTED_DIRS = ["expected", "conformance/expected"];
const SOURCE = import.meta.url.endsWith(".ts");
// Byte-pinned RFC-001 fixtures; only a source checkout carries them.
const SHIPPED_FIXTURES = new URL(
  "../../../../packages/systems-model/fixtures/conformance-v0.1/",
  import.meta.url,
);

const decodeRecord = Schema.decodeUnknownSync(Schema.fromJsonString(SystemsRun));
const encodeRecord = Schema.encodeSync(Schema.fromJsonString(SystemsRun));
const decodeEvent = Schema.decodeUnknownSync(Schema.fromJsonString(TraceEvent));
const encodeEvent = Schema.encodeSync(Schema.fromJsonString(TraceEvent));
const decodeExperiment = Schema.decodeUnknownSync(Schema.fromJsonString(RunDocument));
const encodeExperiment = Schema.encodeSync(Schema.fromJsonString(RunDocument));
// The plan is this server's own compiler output, stored as written; it is not re-validated.
const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const isSystemsError = Schema.is(SystemsError);

const parse: ParseJson = (bytes, file) => parseStrictJson(bytes, file);

const fail = (
  reason: SystemsError["reason"],
  message: string,
  diagnostics?: ReadonlyArray<ModelDiagnostic>,
) =>
  Effect.fail(
    new SystemsError({
      reason,
      message,
      ...(diagnostics === undefined ? {} : { diagnostics: [...diagnostics] }),
    }),
  );

// Storage and filesystem failures can carry host paths: clients get a fixed message.
const unexpected = (cause: unknown) =>
  isSystemsError(cause)
    ? Effect.fail(cause)
    : Effect.logWarning("Systems operation failed", cause).pipe(
        Effect.andThen(
          fail("operation_failed", "The systems operation failed. Details are in the server log."),
        ),
      );
const guarded = <A, E, R>(effect: Effect.Effect<A, E, R>) => effect.pipe(Effect.catch(unexpected));

const isTerminal = (status: SystemsRun["status"]) =>
  status === "completed" || status === "failed" || status === "cancelled";

const batches = <A>(items: ReadonlyArray<A>) => {
  const out: Array<ReadonlyArray<A>> = [];
  for (let index = 0; index < items.length; index += INSERT_BATCH)
    out.push(items.slice(index, index + INSERT_BATCH));
  return out;
};

const mergeDiagnostics = (...lists: ReadonlyArray<ReadonlyArray<ModelDiagnostic>>) => {
  const seen = new Set<string>();
  return sortDiagnostics(
    lists.flat().filter((diagnostic) => {
      const key = canonicalize(diagnostic);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  );
};

const scheduleOf = (resolved: ResolvedSystem): NonNullable<SystemsCompiledEntry["schedule"]> => ({
  nodes: Object.keys(resolved.nodes).length,
  charts: Object.keys(resolved.charts).length,
  continuousOrder: [...resolved.continuousOrder],
  clocks: resolved.clocks.map((clock) => ({
    id: clock.id,
    period: clock.period,
    priority: clock.priority,
    steps: (resolved.clockSchedules[clock.id] ?? []).map((step) => ({
      node: step.node,
      action: step.action,
    })),
  })),
  outputs: resolved.outputs.map((output) => ({
    id: output.id,
    unit: output.unit,
    valueType: output.valueType,
  })),
});

type HostMessage = FromWorker | { readonly type: "exit" };

interface RunHost {
  readonly messages: Queue.Queue<HostMessage>;
  readonly send: (command: ToWorker) => void;
}

interface SampleRow {
  readonly ordinal: number;
  readonly seconds: number;
  readonly time_num: string;
  readonly time_den: string;
  readonly side: SystemsSignalPoint["side"];
  readonly value: number;
  readonly is_boolean: number;
  readonly unit: string;
}

const pointOf = (row: SampleRow): SystemsSignalPoint => ({
  time: { num: row.time_num, den: row.time_den },
  seconds: row.seconds,
  side: row.side,
  value: row.is_boolean === 1 ? row.value !== 0 : row.value,
});

export const make = Effect.fn("SystemsService.make")(function* (
  options: SystemsServiceOptions = {},
) {
  const sql = yield* SqlClient.SqlClient;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const projects = yield* ProjectService.ProjectService;
  const isExecutable = yield* HostProcess.IsExecutable;
  const context = yield* Effect.context<FileSystem.FileSystem | Path.Path | Crypto.Crypto>();
  yield* runSystemsMigrations();
  const chunkBoundaries = options.chunkBoundaries ?? 256;
  const slots = yield* Semaphore.make(options.maxConcurrentRuns ?? 2);
  const fibers = yield* FiberSet.make();
  const changes = yield* PubSub.unbounded<ProjectId>();
  const cancelRequested = new Set<string>();
  const finished = new Map<string, Set<Deferred.Deferred<SystemsRun>>>();
  const now = Effect.map(DateTime.now, DateTime.formatIso);

  // Projects and paths

  const projectRoot = Effect.fn("SystemsService.projectRoot")(function* (projectId: ProjectId) {
    const project = yield* projects.getById(projectId).pipe(Effect.catch(unexpected));
    if (Option.isNone(project)) return yield* fail("not_found", "Project not found");
    return yield* fs.realPath(project.value.workspaceRoot).pipe(Effect.catch(unexpected));
  });

  /** The systems project directory, resolved under its T3 project without symlinks. */
  const systemsRoot = Effect.fn("SystemsService.systemsRoot")(function* (
    input: SystemsProjectInput,
  ) {
    const relative = input.path.replace(/\/+$/, "");
    if (relative !== "" && !isNormalizedPath(relative))
      return yield* fail(
        "outside_project",
        "A systems project path is relative to its project and cannot leave it",
      );
    const root = yield* projectRoot(input.projectId);
    const full = relative === "" ? root : path.join(root, ...relative.split("/"));
    return yield* guarded(
      Effect.gen(function* () {
        if (!(yield* fs.exists(path.join(full, PROJECT_FILE))))
          return yield* fail("not_found", `No ${PROJECT_FILE} at "${relative || "."}"`);
        if ((yield* fs.realPath(full)) !== full)
          return yield* fail(
            "outside_project",
            "Systems project paths are not followed through symlinks",
          );
        return full;
      }),
    );
  });

  const loadPack = Effect.fn("SystemsService.loadPack")(function* (
    root: string,
    seeds: ReadonlyArray<string>,
  ) {
    return yield* guarded(
      Effect.gen(function* () {
        const files = yield* readReferencedFiles(root, [PROJECT_FILE, ...seeds], parse);
        return yield* validatePack(files);
      }),
    );
  });

  /** Files under `dir` ending in `suffix`, systems-project-relative; bounded, never symlinked. */
  const listFiles = (root: string, dir: string, suffix: string) =>
    guarded(
      Effect.gen(function* () {
        const full = path.join(root, ...dir.split("/"));
        if (!(yield* fs.exists(full)) || (yield* fs.realPath(full)) !== full) return [];
        const entries = yield* fs.readDirectory(full, { recursive: true });
        return entries
          .map((entry) => `${dir}/${entry.split(path.sep).join("/")}`)
          .filter((entry) => entry.endsWith(suffix) && !entry.includes("/node_modules/"))
          .toSorted()
          .slice(0, LISTED_FILES_LIMIT);
      }),
    );
  const listExpectedTraces = (root: string) =>
    Effect.forEach(EXPECTED_DIRS, (dir) => listFiles(root, dir, ".trace.json")).pipe(
      Effect.map((lists) => lists.flat()),
    );

  // Validation and compilation

  const validate = Effect.fn("SystemsService.validate")(function* (
    input: typeof SystemsValidateInput.Type,
  ) {
    const root = yield* systemsRoot(input);
    const pack = yield* loadPack(root, input.experiments ?? []);
    const project = pack.documents.get(PROJECT_FILE);
    return {
      name: project?.format === "sw.project" ? project.value.name : "",
      entrypoints: project?.format === "sw.project" ? [...project.value.entrypoints] : [],
      experiments: yield* listFiles(root, "experiments", ".run.json"),
      expectedTraces: yield* listExpectedTraces(root),
      diagnostics: [...pack.diagnostics],
    };
  });

  const compile = Effect.fn("SystemsService.compile")(function* (
    input: typeof SystemsCompileInput.Type,
  ) {
    const root = yield* systemsRoot(input);
    const pack = yield* loadPack(root, []);
    const project = pack.documents.get(PROJECT_FILE);
    const entries =
      input.entry !== undefined
        ? [input.entry]
        : project?.format === "sw.project"
          ? project.value.entrypoints
          : [];
    return {
      entries: yield* Effect.forEach(entries, (entry) =>
        compileSystem(pack, entry).pipe(
          Effect.map(({ resolved, diagnostics }) => ({
            entry,
            ...(resolved === undefined
              ? {}
              : {
                  systemId: resolved.systemId,
                  semanticDigest: resolved.semanticDigest,
                  planDigest: resolved.planDigest,
                  compilerVersion: resolved.compilerVersion,
                  schedule: scheduleOf(resolved),
                }),
            diagnostics: [...diagnostics],
          })),
        ),
      ),
    };
  });

  const semanticDiff = Effect.fn("SystemsService.semanticDiff")(function* (
    input: typeof SystemsSemanticDiffInput.Type,
  ) {
    const root = yield* systemsRoot(input);
    const pack = yield* loadPack(root, [input.before, input.after]);
    const before = pack.documents.get(input.before);
    const after = pack.documents.get(input.after);
    const invalid = () =>
      fail(
        "invalid_model",
        "Both files must be valid systems, or both valid statecharts",
        mergeDiagnostics(diagnosticsFor(pack, input.before), diagnosticsFor(pack, input.after)),
      );
    if (before?.format === "sw.system" && after?.format === "sw.system")
      return {
        format: "sw.system" as const,
        beforeDigest: yield* digest(semanticNormalize(before.value)),
        afterDigest: yield* digest(semanticNormalize(after.value)),
        changes: { ...diffDocuments(before.value, after.value) },
      };
    if (before?.format === "sw.statechart" && after?.format === "sw.statechart")
      return {
        format: "sw.statechart" as const,
        beforeDigest: yield* digest(semanticNormalize(before.value)),
        afterDigest: yield* digest(semanticNormalize(after.value)),
        changes: { ...diffDocuments(before.value, after.value) },
      };
    return yield* invalid();
  });

  // Run storage

  const readRecord = (runId: string) =>
    sql<{ readonly record_json: string }>`
        SELECT record_json FROM systems_runs WHERE run_id = ${runId}
      `.pipe(
      Effect.map((rows) => (rows[0] === undefined ? undefined : decodeRecord(rows[0].record_json))),
    );

  const saveRecord = (record: SystemsRun) =>
    sql`
        UPDATE systems_runs SET status = ${record.status}, record_json = ${encodeRecord(record)}
        WHERE run_id = ${record.runId}
      `;

  const recordIn = Effect.fn("SystemsService.recordIn")(function* (ref: SystemsRunRef) {
    const record = yield* guarded(readRecord(ref.runId));
    if (record === undefined || record.projectId !== ref.projectId)
      return yield* fail("not_found", "Run not found");
    return record;
  });

  const published = (record: SystemsRun) =>
    PubSub.publish(changes, record.projectId).pipe(Effect.as(record));

  const settle = Effect.fn("SystemsService.settle")(function* (record: SystemsRun) {
    const waiters = finished.get(record.runId) ?? new Set();
    finished.delete(record.runId);
    cancelRequested.delete(record.runId);
    for (const waiter of waiters) yield* Deferred.succeed(waiter, record);
    return yield* published(record);
  });

  const commit = (
    record: SystemsRun,
    trace: ReadonlyArray<TraceEvent>,
    samples: ReadonlyArray<SignalSample>,
  ) =>
    sql.withTransaction(
      Effect.gen(function* () {
        for (const batch of batches(trace))
          yield* sql`INSERT INTO systems_run_events ${sql.insert(
            batch.map((event) => ({
              run_id: record.runId,
              sequence: Number(event.sequence),
              event_json: encodeEvent(event),
            })),
          )}`;
        let ordinal = record.sampleCount;
        for (const batch of batches(samples))
          yield* sql`INSERT INTO systems_run_samples ${sql.insert(
            batch.map((sample) => ({
              run_id: record.runId,
              ordinal: ordinal++,
              signal_id: sample.signalId,
              seconds: toNumber(sample.time),
              time_num: sample.time.num,
              time_den: sample.time.den,
              side: sample.side,
              value: typeof sample.value === "boolean" ? Number(sample.value) : sample.value,
              is_boolean: typeof sample.value === "boolean" ? 1 : 0,
              unit: sample.unit,
            })),
          )}`;
        const next: SystemsRun = {
          ...record,
          eventCount: record.eventCount + trace.length,
          sampleCount: record.sampleCount + samples.length,
        };
        yield* saveRecord(next);
        return next;
      }),
    );

  // Execution

  const workerUrl = new URL(
    SOURCE ? "../systems-worker.ts" : "./systems-worker.mjs",
    import.meta.url,
  );

  /** A worker thread, or in a single-file executable (no sibling script) the same driver here. */
  const startHost = (job: WorkerJob) =>
    Effect.acquireRelease(
      Effect.gen(function* () {
        const messages = yield* Queue.unbounded<HostMessage>();
        const deliver = (message: HostMessage) => {
          Queue.offerUnsafe(messages, message);
        };
        if (isExecutable) {
          const inbox = commandInbox();
          if (job.kind === "run") void driveRun(job, { post: deliver, next: inbox.next });
          return {
            host: { messages, send: inbox.push },
            stop: () => inbox.push({ type: "cancel" }),
          };
        }
        const worker = new NodeWorkerThreads.Worker(workerUrl, { workerData: job });
        worker.on("message", deliver);
        worker.on("error", (cause) => deliver({ type: "error", message: String(cause) }));
        worker.on("exit", () => deliver({ type: "exit" }));
        return {
          host: {
            messages,
            // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a worker_threads port, not a window
            send: (command: ToWorker) => worker.postMessage(command),
          },
          stop: () => void worker.terminate(),
        };
      }),
      ({ stop }) => Effect.sync(stop),
    ).pipe(Effect.map(({ host }): RunHost => host));

  const failWorker = (record: SystemsRun, message: string) =>
    Effect.logWarning("Systems worker failed", { runId: record.runId, message }).pipe(
      Effect.andThen(now),
      Effect.flatMap((finishedAt) => {
        const next: SystemsRun = {
          ...record,
          status: "failed",
          hostDiagnostic: {
            code: "worker_failed",
            message: "The simulation worker failed. Details are in the server log.",
          },
          finishedAt,
        };
        return saveRecord(next).pipe(Effect.as(next));
      }),
    );

  const drive = Effect.fn("SystemsService.drive")(function* (initial: SystemsRun, job: RunJob) {
    const host = yield* startHost(job);
    let record = initial;
    let lastPublish = Number.NEGATIVE_INFINITY;
    for (;;) {
      const message = yield* Queue.take(host.messages);
      switch (message.type) {
        case "chunk": {
          record = yield* commit(
            { ...record, lastCommittedTime: message.time, boundaries: message.boundaries },
            message.trace,
            message.samples,
          );
          const at = yield* Clock.currentTimeMillis;
          if (at - lastPublish >= PROGRESS_PUBLISH_MS) {
            lastPublish = at;
            yield* published(record);
          }
          host.send({ type: cancelRequested.has(record.runId) ? "cancel" : "continue" });
          break;
        }
        case "done": {
          const committed = yield* commit(
            {
              ...record,
              status: message.status,
              lastCommittedTime: message.lastCommittedTime,
              boundaries: message.boundaries,
              diagnostics: [...message.diagnostics],
              finishedAt: yield* now,
            },
            message.trace,
            message.samples,
          );
          return committed;
        }
        case "error":
          return yield* failWorker(record, message.message);
        case "exit":
          return yield* failWorker(record, "The worker exited before the run finished");
        case "conformance":
          return yield* failWorker(record, "The worker answered a run with a conformance report");
      }
    }
  }, Effect.scoped);

  /** Waits for a slot, then runs a queued run to its end. Cancelled-while-queued runs skip. */
  const execute = (runId: string) =>
    slots
      .withPermits(1)(
        Effect.gen(function* () {
          const startedAt = yield* now;
          const claimed = yield* sql<{
            readonly record_json: string;
            readonly plan_json: string;
            readonly experiment_json: string;
          }>`
            UPDATE systems_runs SET status = 'running'
            WHERE run_id = ${runId} AND status = 'queued'
            RETURNING record_json, plan_json, experiment_json
          `;
          const row = claimed[0];
          if (row === undefined) return;
          const record: SystemsRun = {
            ...decodeRecord(row.record_json),
            status: "running",
            startedAt,
          };
          yield* saveRecord(record);
          yield* published(record);
          const resolved = decodeJson(row.plan_json) as ResolvedSystem | ResolvedChart;
          const run = decodeExperiment(row.experiment_json);
          const done = yield* drive(record, {
            kind: "run",
            runId,
            resolved,
            run,
            chunkBoundaries,
          }).pipe(
            // A host-side failure ends the run with what it committed; interruption does not.
            Effect.catch((cause) =>
              Effect.logWarning("Systems run host failed", { runId, cause }).pipe(
                Effect.andThen(readRecord(runId)),
                Effect.flatMap((latest) =>
                  failWorker(latest ?? record, "The host failed while driving the run"),
                ),
              ),
            ),
          );
          yield* settle(done);
        }),
      )
      .pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Systems run failed to execute", { runId, cause }),
        ),
      );

  const enqueue = (runId: string) => FiberSet.run(fibers, execute(runId)).pipe(Effect.asVoid);

  // Runs

  const create = Effect.fn("SystemsService.runs.create")(function* (
    input: typeof SystemsRunCreateInput.Type,
  ) {
    const existing = yield* guarded(
      sql<{ readonly record_json: string }>`
          SELECT record_json FROM systems_runs
          WHERE project_id = ${input.projectId} AND idempotency_key = ${input.idempotencyKey}
        `,
    );
    const replay = (record: SystemsRun) =>
      record.path === input.path && record.experimentRef === input.experimentRef
        ? Effect.succeed(record)
        : fail(
            "invalid_model",
            "This idempotency key already created a run for another experiment",
          );
    if (existing[0] !== undefined) return yield* replay(decodeRecord(existing[0].record_json));

    const root = yield* systemsRoot(input);
    const pack = yield* loadPack(root, [input.experimentRef]);
    const loaded = pack.documents.get(input.experimentRef);
    if (loaded?.format !== "sw.run")
      return yield* fail(
        "invalid_model",
        `"${input.experimentRef}" is not a valid experiment`,
        diagnosticsFor(pack, input.experimentRef),
      );
    const run = loaded.value;
    const compiled =
      run.modelRef !== undefined
        ? yield* compileSystem(pack, run.modelRef)
        : yield* compileChart(pack, run.chartRef ?? "");
    const diagnostics = mergeDiagnostics(
      diagnosticsFor(pack, input.experimentRef),
      compiled.diagnostics,
    );
    if (compiled.resolved === undefined || hasErrors(diagnostics))
      return yield* fail("invalid_model", "The experiment does not compile", diagnostics);
    const resolved = compiled.resolved;
    const system = "systemId" in resolved ? resolved : undefined;

    const profile = runnerCapabilities();
    const experimentDigest = yield* digest(run);
    const inputDigest = yield* digest(run.inputs);
    const runId = `sysrun_${yield* crypto.randomUUIDv4().pipe(Effect.catch(unexpected))}`;
    const createdAt = yield* now;
    const record: SystemsRun = {
      runId,
      projectId: input.projectId,
      path: input.path,
      experimentRef: input.experimentRef,
      experimentId: run.id,
      entityId: system?.systemId ?? ("chart" in resolved ? resolved.chart.id : run.id),
      status: "queued",
      semanticDigest: resolved.semanticDigest,
      planDigest: resolved.planDigest,
      runDigest: yield* digest({
        planDigest: resolved.planDigest,
        experimentDigest,
        inputDigest,
        solver: run.solver,
        seed: run.seed,
      }),
      experimentDigest,
      inputDigest,
      solver: run.solver.method,
      seed: run.seed,
      compilerVersion: system?.compilerVersion ?? COMPILER_VERSION,
      runtimeVersion: profile.runtimeVersion,
      capabilityProfile: canonicalize(profile),
      capabilityDigest: yield* digest(profile),
      start: run.start,
      stop: run.stop,
      lastCommittedTime: run.start,
      boundaries: 0,
      eventCount: 0,
      sampleCount: 0,
      probes: (system?.outputs ?? [])
        .filter((output) => run.probes.includes(output.id))
        .map((output) => ({ id: output.id, unit: output.unit, valueType: output.valueType })),
      diagnostics: [...diagnostics],
      createdAt,
    };
    // A concurrent create with the same key loses the insert and returns the winner's run.
    yield* guarded(sql`
        INSERT INTO systems_runs (
          run_id, project_id, systems_path, experiment_ref, idempotency_key, status,
          record_json, plan_json, experiment_json, created_at
        ) VALUES (
          ${runId}, ${input.projectId}, ${input.path}, ${input.experimentRef},
          ${input.idempotencyKey}, 'queued', ${encodeRecord(record)}, ${encodeJson(resolved)},
          ${encodeExperiment(run)}, ${createdAt}
        )
        ON CONFLICT (project_id, idempotency_key) DO NOTHING
      `);
    const stored = yield* guarded(
      sql<{ readonly record_json: string }>`
          SELECT record_json FROM systems_runs
          WHERE project_id = ${input.projectId} AND idempotency_key = ${input.idempotencyKey}
        `,
    );
    const winner = decodeRecord(stored[0]!.record_json);
    if (winner.runId !== runId) return yield* replay(winner);
    yield* published(record);
    yield* enqueue(runId);
    return record;
  });

  const get: SystemsService["Service"]["getRun"] = (input) => recordIn(input);

  const list: SystemsService["Service"]["listRuns"] = Effect.fn("SystemsService.runs.list")(
    function* (input) {
      const rows = yield* guarded(
        input.path === undefined
          ? sql<{ readonly record_json: string }>`
                SELECT record_json FROM systems_runs WHERE project_id = ${input.projectId}
                ORDER BY created_at DESC, run_id DESC LIMIT ${RUN_LIST_LIMIT}
              `
          : sql<{ readonly record_json: string }>`
                SELECT record_json FROM systems_runs
                WHERE project_id = ${input.projectId} AND systems_path = ${input.path}
                ORDER BY created_at DESC, run_id DESC LIMIT ${RUN_LIST_LIMIT}
              `,
      );
      return { runs: rows.map((row) => decodeRecord(row.record_json)) };
    },
  );

  const subscribe: SystemsService["Service"]["subscribeRuns"] = (input) =>
    Stream.unwrap(
      Effect.gen(function* () {
        // Subscribe before reading so no change between the two is lost.
        const subscription = yield* PubSub.subscribe(changes);
        return Stream.concat(
          Stream.fromEffect(list(input)),
          Stream.fromSubscription(subscription).pipe(
            Stream.filter((projectId) => projectId === input.projectId),
            Stream.mapEffect(() => list(input)),
          ),
        );
      }),
    );

  const cancel: SystemsService["Service"]["cancelRun"] = Effect.fn("SystemsService.runs.cancel")(
    function* (input) {
      const record = yield* recordIn(input);
      if (isTerminal(record.status)) return record;
      return yield* guarded(
        Effect.gen(function* () {
          const finishedAt = yield* now;
          const cancelled: SystemsRun = { ...record, status: "cancelled", finishedAt };
          const queued = yield* sql`
            UPDATE systems_runs
            SET status = 'cancelled', record_json = ${encodeRecord(cancelled)},
              cancel_idempotency_key = ${input.idempotencyKey}
            WHERE run_id = ${input.runId} AND status = 'queued'
            RETURNING run_id
          `;
          if (queued.length > 0) return yield* settle(cancelled);
          yield* sql`
            UPDATE systems_runs SET cancel_idempotency_key = ${input.idempotencyKey}
            WHERE run_id = ${input.runId} AND cancel_idempotency_key IS NULL
          `;
          cancelRequested.add(input.runId);
          return (yield* readRecord(input.runId)) ?? record;
        }),
      );
    },
  );

  const awaitRun: SystemsService["Service"]["awaitRun"] = Effect.fn("SystemsService.runs.await")(
    function* (input) {
      // Register before reading so a run finishing in between still resolves this waiter.
      const waiter = yield* Deferred.make<SystemsRun>();
      const waiters = finished.get(input.runId) ?? new Set();
      finished.set(input.runId, waiters.add(waiter));
      return yield* recordIn(input).pipe(
        Effect.flatMap((record) =>
          isTerminal(record.status) ? Effect.succeed(record) : Deferred.await(waiter),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            waiters.delete(waiter);
            if (waiters.size === 0 && finished.get(input.runId) === waiters)
              finished.delete(input.runId);
          }),
        ),
      );
    },
  );

  const events: SystemsService["Service"]["runEvents"] = Effect.fn("SystemsService.runs.events")(
    function* (input) {
      yield* recordIn(input);
      const from = Number(input.fromSequence);
      if (!Number.isSafeInteger(from)) return yield* fail("not_found", "Sequence out of range");
      const rows = yield* guarded(sql<{ readonly event_json: string }>`
        SELECT event_json FROM systems_run_events
        WHERE run_id = ${input.runId} AND sequence >= ${from}
        ORDER BY sequence LIMIT ${input.limit + 1}
      `);
      const page = rows.slice(0, input.limit).map((row) => decodeEvent(row.event_json));
      const last = page.at(-1);
      return {
        events: page,
        nextSequence: last === undefined ? input.fromSequence : String(BigInt(last.sequence) + 1n),
        hasMore: rows.length > input.limit,
      };
    },
  );

  const series = Effect.fn("SystemsService.series")(function* (
    runId: string,
    signalId: string,
    fromSeconds: number,
    toSeconds: number,
    maxPoints: number,
  ) {
    const [count] = yield* sql<{ readonly total: number; readonly unit: string | null }>`
          SELECT COUNT(*) AS total, MAX(unit) AS unit FROM systems_run_samples
          WHERE run_id = ${runId} AND signal_id = ${signalId}
            AND seconds >= ${fromSeconds} AND seconds <= ${toSeconds}
        `;
    const total = count?.total ?? 0;
    const unit = count?.unit ?? "";
    if (total <= maxPoints) {
      const rows = yield* sql<SampleRow>`
            SELECT ordinal, seconds, time_num, time_den, side, value, is_boolean, unit
            FROM systems_run_samples
            WHERE run_id = ${runId} AND signal_id = ${signalId}
              AND seconds >= ${fromSeconds} AND seconds <= ${toSeconds}
            ORDER BY ordinal
          `;
      return {
        signalId,
        unit,
        resolution: "raw" as const,
        totalSamples: total,
        points: rows.map(pointOf),
      };
    }
    // Each bucket keeps its minimum and maximum sample; SQLite returns the row that won.
    const buckets = Math.floor(maxPoints / 2);
    const width = (toSeconds - fromSeconds) / buckets || 1;
    const extreme = (pick: "MIN" | "MAX") => sql<SampleRow>`
          SELECT ordinal, seconds, time_num, time_den, side, value, is_boolean, unit,
            ${sql.literal(pick)}(value) AS extreme
          FROM (
            SELECT *, MIN(CAST((seconds - ${fromSeconds}) / ${width} AS INTEGER), ${buckets - 1}) AS bucket
            FROM systems_run_samples
            WHERE run_id = ${runId} AND signal_id = ${signalId}
              AND seconds >= ${fromSeconds} AND seconds <= ${toSeconds}
          )
          GROUP BY bucket
        `;
    const rows = new Map<number, SampleRow>();
    for (const row of [...(yield* extreme("MIN")), ...(yield* extreme("MAX"))])
      rows.set(row.ordinal, row);
    return {
      signalId,
      unit,
      resolution: "envelope" as const,
      totalSamples: total,
      points: [...rows.values()].toSorted((a, b) => a.ordinal - b.ordinal).map(pointOf),
    };
  });

  const signals: SystemsService["Service"]["runSignals"] = Effect.fn("SystemsService.runs.signals")(
    function* (input) {
      const record = yield* recordIn(input);
      const from = toNumber(input.from ?? record.start);
      const to = toNumber(input.to ?? record.stop);
      return {
        series: yield* guarded(
          Effect.forEach([...new Set(input.signalIds)], (signalId) =>
            series(input.runId, signalId, from, to, input.maxPoints),
          ),
        ),
      };
    },
  );

  const compareRun = Effect.fn("SystemsService.runs.compare")(function* (
    input: typeof SystemsRunCompareInput.Type,
  ) {
    const record = yield* recordIn(input);
    if (!isTerminal(record.status)) return yield* fail("unavailable", "The run has not finished");
    if (record.eventCount + record.sampleCount > COMPARE_ROWS_LIMIT)
      return yield* fail("too_large", "The run is too large to compare in one request");
    const root = yield* systemsRoot(record);
    const candidates =
      input.expectedRef !== undefined ? [input.expectedRef] : yield* listExpectedTraces(root);
    const pack = yield* loadPack(root, candidates);
    const expected = candidates.flatMap((ref) => {
      const loaded = pack.documents.get(ref);
      return loaded?.format === "sw.expectedTrace" && loaded.value.runRef === record.experimentRef
        ? [{ ref, trace: loaded.value }]
        : [];
    })[0];
    if (expected === undefined) return { expectedRef: null, mismatches: [] };
    const trace = yield* guarded(
      sql<{ readonly event_json: string }>`
          SELECT event_json FROM systems_run_events WHERE run_id = ${record.runId} ORDER BY sequence
        `.pipe(Effect.map((rows) => rows.map((row) => decodeEvent(row.event_json)))),
    );
    const samples = yield* guarded(
      sql<SampleRow & { readonly signal_id: string }>`
          SELECT ordinal, signal_id, seconds, time_num, time_den, side, value, is_boolean, unit
          FROM systems_run_samples WHERE run_id = ${record.runId} ORDER BY ordinal
        `,
    );
    const mismatches = compareToExpected(
      {
        status: record.status,
        lastCommittedTime: record.lastCommittedTime,
        trace,
        samples: samples.map((row): SignalSample => {
          const point = pointOf(row);
          return {
            signalId: row.signal_id,
            time: point.time,
            side: point.side,
            value: point.value,
            unit: row.unit,
          };
        }),
        diagnostics: record.diagnostics,
      },
      expected.trace,
    );
    return {
      expectedRef: expected.ref,
      mismatches: mismatches.map((mismatch) => ({
        kind: mismatch.kind,
        message: mismatch.message,
        ...(mismatch.time === undefined ? {} : { time: mismatch.time }),
        ...(mismatch.entityId === undefined ? {} : { entityId: mismatch.entityId }),
      })),
    };
  });

  // Conformance and capabilities

  const runConformance = (files: PackFiles) =>
    slots.withPermits(1)(
      isExecutable
        ? guarded(conformanceOf(files).pipe(Effect.provide(context)))
        : Effect.scoped(
            Effect.gen(function* () {
              const host = yield* startHost({ kind: "conformance", files });
              const message = yield* Queue.take(host.messages);
              if (message.type === "conformance") return message.reports;
              yield* Effect.logWarning("Systems conformance worker failed", message);
              return yield* fail(
                "operation_failed",
                "The conformance worker failed. Details are in the server log.",
              );
            }),
          ),
    );

  const execute_ = Effect.fn("SystemsService.conformance.execute")(function* (
    input: typeof SystemsConformanceInput.Type,
  ) {
    const files =
      input.project === undefined
        ? SOURCE
          ? yield* guarded(
              Effect.flatMap(path.fromFileUrl(SHIPPED_FIXTURES), (root) => readPackFiles(root)),
            )
          : yield* fail("unavailable", "This build does not include the RFC-001 fixture pack")
        : yield* guarded(
            Effect.flatMap(systemsRoot(input.project), (root) =>
              readReferencedFiles(root, [PROJECT_FILE, input.project!.manifest], parse),
            ),
          );
    const reports = yield* runConformance(files);
    return {
      runtimeVersion: runnerCapabilities().runtimeVersion,
      reports: reports.map((report) => ({
        id: report.id,
        source: report.source,
        status: report.status,
        details: [...report.details],
        diagnostics: [...report.diagnostics],
      })),
      diagnostics: [...files.diagnostics],
    };
  });

  const capabilities: SystemsService["Service"]["capabilities"] = () =>
    Effect.sync(() => {
      const profile = runnerCapabilities();
      return { targetId: "local", ...profile, capabilities: { ...profile.capabilities } };
    });

  // Restart: what was running lost its worker and keeps only what it committed.
  yield* Effect.gen(function* () {
    const finishedAt = yield* now;
    const running = yield* sql<{ readonly record_json: string }>`
        SELECT record_json FROM systems_runs WHERE status = 'running'
      `;
    for (const row of running)
      yield* saveRecord({
        ...decodeRecord(row.record_json),
        status: "failed",
        hostDiagnostic: {
          code: "interrupted",
          message: "The server stopped during this run; its committed trace and samples are kept.",
        },
        finishedAt,
      });
    const queued = yield* sql<{ readonly run_id: string }>`
        SELECT run_id FROM systems_runs WHERE status = 'queued' ORDER BY created_at, run_id
      `;
    for (const row of queued) yield* enqueue(row.run_id);
  }).pipe(Effect.catch((cause) => Effect.logWarning("Systems run recovery failed", cause)));

  // The model packages read files and hash through the services captured at construction.
  const provided =
    <I, A, E>(
      method: (input: I) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | Crypto.Crypto>,
    ) =>
    (input: I) =>
      method(input).pipe(Effect.provide(context));

  return SystemsService.of({
    validate: provided(validate),
    compile: provided(compile),
    semanticDiff: provided(semanticDiff),
    createRun: provided(create),
    getRun: get,
    listRuns: list,
    subscribeRuns: subscribe,
    cancelRun: cancel,
    awaitRun,
    runEvents: events,
    runSignals: signals,
    compareRun: provided(compareRun),
    executeConformance: provided(execute_),
    capabilities,
  });
});

export const layer = Layer.effect(SystemsService, make());
