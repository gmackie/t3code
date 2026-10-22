import * as Schema from "effect/Schema";

/**
 * Domain-neutral engine vocabulary. Nothing here may name a project, thread,
 * workspace path, branch or provider session: coding is one module on the
 * engine, not part of its contract. `packages/engine` depends only on
 * `effect`; the import boundary is enforced in the root lint config.
 */

const isTrimmedNonBlank = Schema.makeFilter(
  (value: string) => value.length > 0 && value.trim() === value,
  { expected: "a non-blank string without surrounding whitespace" },
);
const NonBlankString = Schema.String.check(isTrimmedNonBlank, Schema.isMaxLength(256));
const PositiveInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** Dotted lowercase name, e.g. `cad`, `cad.release`, `travel.booking.approve`. */
export const EngineName = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/),
  Schema.isMaxLength(128),
);
export type EngineName = typeof EngineName.Type;

const engineId = <Brand extends string>(brand: Parameters<typeof Schema.brand<Brand>>[0]) =>
  NonBlankString.pipe(Schema.brand<Brand>(brand));

export const TenantId = engineId("EngineTenantId");
export type TenantId = typeof TenantId.Type;
export const PrincipalId = engineId("EnginePrincipalId");
export type PrincipalId = typeof PrincipalId.Type;
export const ScopeId = engineId("EngineScopeId");
export type ScopeId = typeof ScopeId.Type;
export const RunId = engineId("EngineRunId");
export type RunId = typeof RunId.Type;
export const StepId = engineId("EngineStepId");
export type StepId = typeof StepId.Type;
export const AttemptId = engineId("EngineAttemptId");
export type AttemptId = typeof AttemptId.Type;
export const EngineEventId = engineId("EngineEventId");
export type EngineEventId = typeof EngineEventId.Type;
export const ArtifactId = engineId("EngineArtifactId");
export type ArtifactId = typeof ArtifactId.Type;

export const PrincipalKind = Schema.Literals(["human", "agent", "service", "device"]);
export type PrincipalKind = typeof PrincipalKind.Type;

export const PrincipalRef = Schema.Struct({
  tenantId: TenantId,
  principalId: PrincipalId,
  kind: PrincipalKind,
});
export type PrincipalRef = typeof PrincipalRef.Type;

/** Opaque pointer to a domain-owned object; never a filesystem path to open. */
export const ResourceRef = Schema.Struct({
  namespace: EngineName,
  type: EngineName,
  id: NonBlankString,
  revision: Schema.optionalKey(NonBlankString),
});
export type ResourceRef = typeof ResourceRef.Type;

export const ScopeRef = Schema.Struct({ tenantId: TenantId, scopeId: ScopeId });
export type ScopeRef = typeof ScopeRef.Type;

export const OperationRef = Schema.Struct({ id: EngineName, version: PositiveInt });
export type OperationRef = typeof OperationRef.Type;

/** Stable registry key, e.g. `cad.release.commit@1`. */
export const operationKey = (ref: OperationRef): string => `${ref.id}@${ref.version}`;

export const ExecutionTargetRef = Schema.Struct({
  targetId: NonBlankString,
  driverId: NonBlankString,
  region: Schema.optionalKey(NonBlankString),
});
export type ExecutionTargetRef = typeof ExecutionTargetRef.Type;

export const RunBudget = Schema.Struct({
  maxTokens: Schema.optionalKey(PositiveInt),
  maxUsd: Schema.optionalKey(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))),
  deadlineMs: Schema.optionalKey(PositiveInt),
});
export type RunBudget = typeof RunBudget.Type;

export const RunStatus = Schema.Literals([
  "created",
  "queued",
  "leased",
  "running",
  "waiting-approval",
  "waiting-input",
  "waiting-event",
  "retry-scheduled",
  "suspended",
  "completed",
  "failed",
  "cancelled",
  "outcome-unknown",
]);
export type RunStatus = typeof RunStatus.Type;

/**
 * What a caller asks for. Tenant and acting principals are deliberately absent:
 * the server binds them from the authenticated session and never trusts a
 * client-supplied identity.
 */
export const RunSpec = Schema.Struct({
  apiVersion: Schema.Literal("t3.engine/v1"),
  moduleId: EngineName,
  moduleVersion: NonBlankString,
  workflowId: EngineName,
  parentRunId: Schema.optionalKey(RunId),
  scopeId: Schema.optionalKey(ScopeId),
  resourceRefs: Schema.Array(ResourceRef).check(Schema.isMaxLength(64)),
  target: Schema.optionalKey(ExecutionTargetRef),
  inputArtifactIds: Schema.Array(ArtifactId).check(Schema.isMaxLength(64)),
  configurationRef: Schema.optionalKey(NonBlankString),
  idempotencyKey: NonBlankString,
  requestedBudget: Schema.optionalKey(RunBudget),
});
export type RunSpec = typeof RunSpec.Type;

/** Server-authored read model of a run. */
export const RunView = Schema.Struct({
  runId: RunId,
  tenantId: TenantId,
  status: RunStatus,
  revision: NonNegativeInt,
  createdBy: PrincipalRef,
  actingFor: Schema.optionalKey(PrincipalRef),
  spec: RunSpec,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  finishedAt: Schema.optionalKey(Schema.String),
  lastErrorCode: Schema.optionalKey(EngineName),
});
export type RunView = typeof RunView.Type;

/**
 * Append-only fact on one stream. Ordering is per stream (`streamVersion`),
 * never global. `payload` is decoded by the module that owns `type`.
 */
export const EngineEvent = Schema.Struct({
  eventId: EngineEventId,
  tenantId: TenantId,
  streamId: NonBlankString,
  streamVersion: PositiveInt,
  type: EngineName,
  runId: Schema.optionalKey(RunId),
  actor: PrincipalRef,
  occurredAt: Schema.String,
  payload: Schema.Unknown,
});
export type EngineEvent = typeof EngineEvent.Type;

export class EngineAuthorizationDenied extends Schema.TaggedError<EngineAuthorizationDenied>()(
  "EngineAuthorizationDenied",
  { publicReasonCode: EngineName },
) {}

export class EngineRevisionConflict extends Schema.TaggedError<EngineRevisionConflict>()(
  "EngineRevisionConflict",
  { streamId: NonBlankString, expectedVersion: NonNegativeInt, actualVersion: NonNegativeInt },
) {}

/** An idempotency key was reused for a different command or stream. */
export class EngineIdempotencyConflict extends Schema.TaggedError<EngineIdempotencyConflict>()(
  "EngineIdempotencyConflict",
  { idempotencyKey: NonBlankString },
) {}

export class EngineNotFound extends Schema.TaggedError<EngineNotFound>()("EngineNotFound", {
  kind: EngineName,
  id: NonBlankString,
}) {}

export const EngineError = Schema.Union([
  EngineAuthorizationDenied,
  EngineRevisionConflict,
  EngineIdempotencyConflict,
  EngineNotFound,
]);
export type EngineError = typeof EngineError.Type;
