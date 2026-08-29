import * as Schema from "effect/Schema";

import {
  EnvironmentId,
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ProviderInstanceRef } from "./providerInstance.ts";

export const EXTERNAL_THREAD_IMPORT_MAX_BATCH_SIZE = 200;
export const EXTERNAL_THREAD_IMPORT_MAX_OPAQUE_VALUE_LENGTH = 8_192;

/** Server-issued identity for a discovered native thread. Its contents are opaque to clients. */
export const ExternalThreadImportCandidateToken = TrimmedNonEmptyString.check(
  Schema.isMaxLength(EXTERNAL_THREAD_IMPORT_MAX_OPAQUE_VALUE_LENGTH),
).pipe(Schema.brand("ExternalThreadImportCandidateToken"));
export type ExternalThreadImportCandidateToken = typeof ExternalThreadImportCandidateToken.Type;

export const ExternalThreadImportCandidateStatus = Schema.Union([
  Schema.TaggedStruct("Available", {}),
  Schema.TaggedStruct("AlreadyImported", { threadId: ThreadId }),
]);
export type ExternalThreadImportCandidateStatus = typeof ExternalThreadImportCandidateStatus.Type;

export const ExternalThreadImportCandidate = Schema.Struct({
  token: ExternalThreadImportCandidateToken,
  provider: ProviderInstanceRef,
  nativeThreadId: Schema.optional(TrimmedNonEmptyString),
  title: Schema.optional(TrimmedNonEmptyString),
  firstPromptPreview: Schema.optional(TrimmedNonEmptyString),
  originalCwd: TrimmedNonEmptyString,
  createdAt: Schema.optional(IsoDateTime),
  updatedAt: IsoDateTime,
  turnCount: Schema.optional(NonNegativeInt),
  messageCount: Schema.optional(NonNegativeInt),
  toolCallCount: Schema.optional(NonNegativeInt),
  status: ExternalThreadImportCandidateStatus,
});
export type ExternalThreadImportCandidate = typeof ExternalThreadImportCandidate.Type;

const ExternalThreadImportPageCursor = TrimmedNonEmptyString.check(
  Schema.isMaxLength(EXTERNAL_THREAD_IMPORT_MAX_OPAQUE_VALUE_LENGTH),
).pipe(Schema.brand("ExternalThreadImportPageCursor"));

export const ExternalThreadImportDiscoveryInput = Schema.Struct({
  environmentId: EnvironmentId,
  projectId: ProjectId,
  cursor: Schema.optional(ExternalThreadImportPageCursor),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(EXTERNAL_THREAD_IMPORT_MAX_BATCH_SIZE)),
});
export type ExternalThreadImportDiscoveryInput = typeof ExternalThreadImportDiscoveryInput.Type;

const ExternalThreadImportProviderDiscoveryResult = Schema.Union([
  Schema.TaggedStruct("Success", {
    provider: ProviderInstanceRef,
    candidates: Schema.Array(ExternalThreadImportCandidate),
  }),
  Schema.TaggedStruct("Failure", {
    provider: ProviderInstanceRef,
    code: TrimmedNonEmptyString,
    message: TrimmedNonEmptyString,
    retryable: Schema.Boolean,
  }),
]);
export type ExternalThreadImportProviderDiscoveryResult =
  typeof ExternalThreadImportProviderDiscoveryResult.Type;

export const ExternalThreadImportDiscoveryResult = Schema.Struct({
  providerResults: Schema.Array(ExternalThreadImportProviderDiscoveryResult),
  nextCursor: Schema.optional(ExternalThreadImportPageCursor),
});
export type ExternalThreadImportDiscoveryResult = typeof ExternalThreadImportDiscoveryResult.Type;

export const ExternalThreadImportSelection = Schema.Struct({
  environmentId: EnvironmentId,
  projectId: ProjectId,
  tokens: Schema.Array(ExternalThreadImportCandidateToken).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(EXTERNAL_THREAD_IMPORT_MAX_BATCH_SIZE),
  ),
});
export type ExternalThreadImportSelection = typeof ExternalThreadImportSelection.Type;

export const ExternalThreadImportOutcome = Schema.Union([
  Schema.TaggedStruct("Imported", {
    token: ExternalThreadImportCandidateToken,
    threadId: ThreadId,
  }),
  Schema.TaggedStruct("AlreadyImported", {
    token: ExternalThreadImportCandidateToken,
    threadId: ThreadId,
  }),
  Schema.TaggedStruct("Failed", {
    token: ExternalThreadImportCandidateToken,
    code: TrimmedNonEmptyString,
    message: TrimmedNonEmptyString,
    retryable: Schema.optional(Schema.Boolean),
  }),
]);
export type ExternalThreadImportOutcome = typeof ExternalThreadImportOutcome.Type;

export const ExternalThreadImportBatchResult = Schema.Struct({
  outcomes: Schema.Array(ExternalThreadImportOutcome),
});
export type ExternalThreadImportBatchResult = typeof ExternalThreadImportBatchResult.Type;

export class ExternalThreadImportRequestError extends Schema.TaggedErrorClass<ExternalThreadImportRequestError>()(
  "ExternalThreadImportRequestError",
  {
    code: TrimmedNonEmptyString,
    message: TrimmedNonEmptyString,
    retryable: Schema.optional(Schema.Boolean),
  },
) {}

/** Provider-owned continuation identity persisted separately from normalized display history. */
export const ExternalThreadImportProvenance = Schema.Struct({
  provider: ProviderInstanceRef,
  nativeThreadId: TrimmedNonEmptyString,
  continuationGroup: TrimmedNonEmptyString,
  originalCwd: TrimmedNonEmptyString,
  resumeCursor: Schema.optional(Schema.Json),
  decoderVersion: TrimmedNonEmptyString,
  importedAt: IsoDateTime,
});
export type ExternalThreadImportProvenance = typeof ExternalThreadImportProvenance.Type;
