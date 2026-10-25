import * as Schema from "effect/Schema";
import { ModelDiagnostic } from "@t3tools/systems-model/diagnostics";
import { RationalTime } from "@t3tools/systems-model/rational";
import { SignalValue, TraceEvent } from "@t3tools/systems-model/trace";

import { IsoDateTime, NonNegativeInt, ProjectId } from "./baseSchemas.ts";

/**
 * Systems Workbench (RFC-001 §13.2) over the environment socket. A systems project is a
 * directory inside a T3 project, named by project id and project-relative path. Runs belong
 * to the environment, not to a thread or connection, and are immutable once created.
 */

export { ModelDiagnostic as SystemsDiagnostic, TraceEvent as SystemsTraceEvent };

const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
/** Project-relative, `/`-separated; empty for the project root. The server rejects traversal. */
export const SystemsPath = Schema.String.check(Schema.isMaxLength(1024));
/** Systems-project-relative file such as `experiments/pump-nominal.run.json`. */
export const SystemsFileRef = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1024));
const Digest = Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/));
const Sequence = Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]*)$/));

export const SystemsProjectInput = Schema.Struct({ projectId: ProjectId, path: SystemsPath });
export type SystemsProjectInput = typeof SystemsProjectInput.Type;

export const SystemsValidateInput = Schema.Struct({
  ...SystemsProjectInput.fields,
  /** Experiments to validate along with the project closure. */
  experiments: Schema.optionalKey(Schema.Array(SystemsFileRef).check(Schema.isMaxLength(64))),
});
export const SystemsValidateResult = Schema.Struct({
  name: Schema.String,
  entrypoints: Schema.Array(Schema.String),
  /** `*.run.json` under `experiments/`. */
  experiments: Schema.Array(Schema.String),
  /** `*.trace.json` under `expected/` and `conformance/expected/`. */
  expectedTraces: Schema.Array(Schema.String),
  diagnostics: Schema.Array(ModelDiagnostic),
});
export type SystemsValidateResult = typeof SystemsValidateResult.Type;

export const SystemsCompileInput = Schema.Struct({
  ...SystemsProjectInput.fields,
  /** One entrypoint; every entrypoint when omitted. */
  entry: Schema.optionalKey(SystemsFileRef),
});
export const SystemsCompiledEntry = Schema.Struct({
  entry: Schema.String,
  systemId: Schema.optionalKey(Schema.String),
  semanticDigest: Schema.optionalKey(Digest),
  planDigest: Schema.optionalKey(Digest),
  compilerVersion: Schema.optionalKey(Schema.String),
  schedule: Schema.optionalKey(
    Schema.Struct({
      nodes: NonNegativeInt,
      charts: NonNegativeInt,
      continuousOrder: Schema.Array(Schema.String),
      clocks: Schema.Array(
        Schema.Struct({
          id: Schema.String,
          period: RationalTime,
          priority: Schema.Int,
          steps: Schema.Array(Schema.Struct({ node: Schema.String, action: Schema.String })),
        }),
      ),
      outputs: Schema.Array(
        Schema.Struct({ id: Schema.String, unit: Schema.String, valueType: Schema.String }),
      ),
    }),
  ),
  diagnostics: Schema.Array(ModelDiagnostic),
});
export type SystemsCompiledEntry = typeof SystemsCompiledEntry.Type;
export const SystemsCompileResult = Schema.Struct({ entries: Schema.Array(SystemsCompiledEntry) });
export type SystemsCompileResult = typeof SystemsCompileResult.Type;

export const SystemsSemanticDiffInput = Schema.Struct({
  ...SystemsProjectInput.fields,
  /** Two revisions of one system or chart, both inside the systems project. */
  before: SystemsFileRef,
  after: SystemsFileRef,
});
const ElementChanges = Schema.Struct({
  added: Schema.Array(Schema.String),
  removed: Schema.Array(Schema.String),
  changed: Schema.Array(Schema.String),
});
export const SystemsSemanticDiffResult = Schema.Struct({
  format: Schema.Literals(["sw.system", "sw.statechart"]),
  beforeDigest: Digest,
  afterDigest: Digest,
  changes: Schema.Record(Schema.String, ElementChanges),
});
export type SystemsSemanticDiffResult = typeof SystemsSemanticDiffResult.Type;

// Runs

export const SystemsRunStatus = Schema.Literals([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type SystemsRunStatus = typeof SystemsRunStatus.Type;

/** A failure the host saw rather than the model: a restart or a crashed worker. */
export const SystemsHostDiagnostic = Schema.Struct({
  code: Schema.Literals(["interrupted", "worker_failed"]),
  message: Schema.String,
});
export type SystemsHostDiagnostic = typeof SystemsHostDiagnostic.Type;

export const SystemsRunProbe = Schema.Struct({
  id: Schema.String,
  unit: Schema.String,
  valueType: Schema.String,
});

/** RFC-001 INV-08: everything needed to say exactly what ran. */
export const SystemsRun = Schema.Struct({
  runId: Id,
  projectId: ProjectId,
  path: SystemsPath,
  experimentRef: Schema.String,
  experimentId: Schema.String,
  entityId: Schema.String,
  status: SystemsRunStatus,
  semanticDigest: Digest,
  planDigest: Digest,
  /** Plan + experiment + input stream + solver + seed (RFC-001 §3.1). */
  runDigest: Digest,
  experimentDigest: Digest,
  inputDigest: Digest,
  solver: Schema.String,
  seed: Schema.String,
  compilerVersion: Schema.String,
  runtimeVersion: Schema.String,
  capabilityProfile: Schema.String,
  capabilityDigest: Digest,
  start: RationalTime,
  stop: RationalTime,
  lastCommittedTime: RationalTime,
  boundaries: NonNegativeInt,
  eventCount: NonNegativeInt,
  sampleCount: NonNegativeInt,
  probes: Schema.Array(SystemsRunProbe),
  diagnostics: Schema.Array(ModelDiagnostic),
  hostDiagnostic: Schema.optionalKey(SystemsHostDiagnostic),
  createdAt: IsoDateTime,
  startedAt: Schema.optionalKey(IsoDateTime),
  finishedAt: Schema.optionalKey(IsoDateTime),
});
export type SystemsRun = typeof SystemsRun.Type;

export const SystemsRunCreateInput = Schema.Struct({
  ...SystemsProjectInput.fields,
  experimentRef: SystemsFileRef,
  /** The same key in the same project returns the run it first created. */
  idempotencyKey: Id,
});
export const SystemsRunRef = Schema.Struct({ projectId: ProjectId, runId: Id });
export type SystemsRunRef = typeof SystemsRunRef.Type;
export const SystemsRunCancelInput = Schema.Struct({ ...SystemsRunRef.fields, idempotencyKey: Id });
export const SystemsRunListInput = Schema.Struct({
  projectId: ProjectId,
  path: Schema.optionalKey(SystemsPath),
});
export const SystemsRunListResult = Schema.Struct({ runs: Schema.Array(SystemsRun) });
export type SystemsRunListResult = typeof SystemsRunListResult.Type;

export const SYSTEMS_EVENTS_PAGE_MAX = 500;
export const SystemsRunEventsInput = Schema.Struct({
  ...SystemsRunRef.fields,
  fromSequence: Sequence,
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: SYSTEMS_EVENTS_PAGE_MAX })),
});
export const SystemsRunEventsResult = Schema.Struct({
  events: Schema.Array(TraceEvent),
  /** Pass back as `fromSequence`; stable across reconnects. */
  nextSequence: Sequence,
  /** More events exist now; a running run may still add more later. */
  hasMore: Schema.Boolean,
});
export type SystemsRunEventsResult = typeof SystemsRunEventsResult.Type;

export const SYSTEMS_SIGNAL_POINTS_MAX = 4000;
export const SystemsRunSignalsInput = Schema.Struct({
  ...SystemsRunRef.fields,
  signalIds: Schema.Array(Id).check(Schema.isMinLength(1), Schema.isMaxLength(16)),
  from: Schema.optionalKey(RationalTime),
  to: Schema.optionalKey(RationalTime),
  maxPoints: Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: SYSTEMS_SIGNAL_POINTS_MAX })),
});
export const SystemsSignalPoint = Schema.Struct({
  time: RationalTime,
  seconds: Schema.Number,
  side: Schema.Literals(["initial", "pre", "post"]),
  value: SignalValue,
});
export type SystemsSignalPoint = typeof SystemsSignalPoint.Type;
export const SystemsSignalSeries = Schema.Struct({
  signalId: Schema.String,
  unit: Schema.String,
  /** `envelope` keeps each bucket's minimum and maximum, in time order. */
  resolution: Schema.Literals(["raw", "envelope"]),
  totalSamples: NonNegativeInt,
  points: Schema.Array(SystemsSignalPoint),
});
export type SystemsSignalSeries = typeof SystemsSignalSeries.Type;
export const SystemsRunSignalsResult = Schema.Struct({ series: Schema.Array(SystemsSignalSeries) });
export type SystemsRunSignalsResult = typeof SystemsRunSignalsResult.Type;

export const SystemsRunCompareInput = Schema.Struct({
  ...SystemsRunRef.fields,
  /** An expected trace in the run's systems project; found by `runRef` when omitted. */
  expectedRef: Schema.optionalKey(SystemsFileRef),
});
export const SystemsMismatch = Schema.Struct({
  kind: Schema.String,
  message: Schema.String,
  time: Schema.optionalKey(RationalTime),
  entityId: Schema.optionalKey(Schema.String),
});
export const SystemsRunCompareResult = Schema.Struct({
  /** No expected trace in the project references the run's experiment. */
  expectedRef: Schema.NullOr(Schema.String),
  mismatches: Schema.Array(SystemsMismatch),
});
export type SystemsRunCompareResult = typeof SystemsRunCompareResult.Type;

export const SystemsConformanceInput = Schema.Struct({
  /** A project's conformance manifest; the shipped RFC-001 v0.1 pack when omitted. */
  project: Schema.optionalKey(
    Schema.Struct({ ...SystemsProjectInput.fields, manifest: SystemsFileRef }),
  ),
});
export const SystemsFixtureReport = Schema.Struct({
  id: Schema.String,
  source: Schema.String,
  status: Schema.Literals(["pass", "fail"]),
  details: Schema.Array(Schema.String),
  diagnostics: Schema.Array(ModelDiagnostic),
});
export const SystemsConformanceResult = Schema.Struct({
  runtimeVersion: Schema.String,
  reports: Schema.Array(SystemsFixtureReport),
  diagnostics: Schema.Array(ModelDiagnostic),
});
export type SystemsConformanceResult = typeof SystemsConformanceResult.Type;

export const SystemsCapabilitiesInput = Schema.Struct({});
export const SystemsCapabilitiesResult = Schema.Struct({
  targetId: Schema.String,
  protocol: Schema.String,
  runtimeVersion: Schema.String,
  semanticsVersions: Schema.Array(Schema.String),
  capabilities: Schema.Record(Schema.String, Schema.Boolean),
  solvers: Schema.Array(Schema.String),
  blocks: Schema.Array(Schema.String),
  deterministicProfile: Schema.String,
});
export type SystemsCapabilitiesResult = typeof SystemsCapabilitiesResult.Type;

export class SystemsError extends Schema.TaggedError<SystemsError>()("SystemsError", {
  reason: Schema.Literals([
    "not_found",
    "outside_project",
    "invalid_model",
    "too_large",
    "unavailable",
    "operation_failed",
  ]),
  message: Schema.String,
  diagnostics: Schema.optionalKey(Schema.Array(ModelDiagnostic)),
}) {}
