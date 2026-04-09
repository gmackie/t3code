import { Option, Schema } from "effect";
import {
  EventId,
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TurnId,
  TrimmedNonEmptyString,
} from "./baseSchemas";
import { ProviderKind } from "./orchestration";

export const LocalPluginEventVersion = 1 as const;

const LocalPluginEventType = Schema.Literal("event");
const LocalPluginEnvelopeVersion = Schema.Literal(LocalPluginEventVersion);

const LocalPluginEventKind = Schema.Literals([
  "session.started",
  "turn.started",
  "turn.settled",
  "approval.required",
  "user-input.required",
  "runtime.error",
  "resource.limit",
]);
export type LocalPluginEventKind = typeof LocalPluginEventKind.Type;

const LocalPluginTurnResult = Schema.Literals(["completed", "failed", "interrupted", "cancelled"]);
export type LocalPluginTurnResult = typeof LocalPluginTurnResult.Type;

const LocalPluginEventBase = Schema.Struct({
  id: EventId,
  kind: LocalPluginEventKind,
  createdAt: IsoDateTime,
  provider: ProviderKind,
  threadId: ThreadId,
  projectId: Schema.optional(ProjectId),
  turnId: Schema.optional(TurnId),
  summary: Schema.optional(TrimmedNonEmptyString),
});
export type LocalPluginEventBase = typeof LocalPluginEventBase.Type;

export const LocalPluginSessionStartedEvent = Schema.Struct({
  ...LocalPluginEventBase.fields,
  kind: Schema.Literal("session.started"),
});
export type LocalPluginSessionStartedEvent = typeof LocalPluginSessionStartedEvent.Type;

export const LocalPluginTurnStartedEvent = Schema.Struct({
  ...LocalPluginEventBase.fields,
  kind: Schema.Literal("turn.started"),
});
export type LocalPluginTurnStartedEvent = typeof LocalPluginTurnStartedEvent.Type;

export const LocalPluginTurnSettledEvent = Schema.Struct({
  ...LocalPluginEventBase.fields,
  kind: Schema.Literal("turn.settled"),
  result: LocalPluginTurnResult,
  errorMessage: Schema.optional(TrimmedNonEmptyString),
});
export type LocalPluginTurnSettledEvent = typeof LocalPluginTurnSettledEvent.Type;

export const LocalPluginApprovalRequiredEvent = Schema.Struct({
  ...LocalPluginEventBase.fields,
  kind: Schema.Literal("approval.required"),
  requestId: Schema.optional(TrimmedNonEmptyString),
  requestKind: Schema.optional(Schema.Literals(["command", "file-read", "file-change", "unknown"])),
  detail: Schema.optional(TrimmedNonEmptyString),
});
export type LocalPluginApprovalRequiredEvent = typeof LocalPluginApprovalRequiredEvent.Type;

export const LocalPluginUserInputRequiredEvent = Schema.Struct({
  ...LocalPluginEventBase.fields,
  kind: Schema.Literal("user-input.required"),
  requestId: Schema.optional(TrimmedNonEmptyString),
  questions: Schema.Array(
    Schema.Struct({
      id: TrimmedNonEmptyString,
      header: TrimmedNonEmptyString,
      question: TrimmedNonEmptyString,
      options: Schema.Array(
        Schema.Struct({
          label: TrimmedNonEmptyString,
          description: TrimmedNonEmptyString,
        }),
      ),
      multiSelect: Schema.optional(Schema.Boolean).pipe(
        Schema.withConstructorDefault(() => Option.some(false)),
      ),
    }),
  ),
});
export type LocalPluginUserInputRequiredEvent = typeof LocalPluginUserInputRequiredEvent.Type;

export const LocalPluginRuntimeErrorEvent = Schema.Struct({
  ...LocalPluginEventBase.fields,
  kind: Schema.Literal("runtime.error"),
  message: TrimmedNonEmptyString,
});
export type LocalPluginRuntimeErrorEvent = typeof LocalPluginRuntimeErrorEvent.Type;

export const LocalPluginResourceLimitEvent = Schema.Struct({
  ...LocalPluginEventBase.fields,
  kind: Schema.Literal("resource.limit"),
  limitKind: TrimmedNonEmptyString,
  message: Schema.optional(TrimmedNonEmptyString),
});
export type LocalPluginResourceLimitEvent = typeof LocalPluginResourceLimitEvent.Type;

export const LocalPluginEvent = Schema.Union([
  LocalPluginSessionStartedEvent,
  LocalPluginTurnStartedEvent,
  LocalPluginTurnSettledEvent,
  LocalPluginApprovalRequiredEvent,
  LocalPluginUserInputRequiredEvent,
  LocalPluginRuntimeErrorEvent,
  LocalPluginResourceLimitEvent,
]);
export type LocalPluginEvent = typeof LocalPluginEvent.Type;

export const LocalPluginEnvelope = Schema.Struct({
  type: LocalPluginEventType,
  version: LocalPluginEnvelopeVersion,
  sequence: NonNegativeInt,
  event: LocalPluginEvent,
});
export type LocalPluginEnvelope = typeof LocalPluginEnvelope.Type;
