import * as Schema from "effect/Schema";

const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
export const ReverseDigest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
export const ReverseAddress = Schema.String.check(Schema.isPattern(/^(?:0x[0-9a-fA-F]+|[0-9]+)$/), Schema.isMaxLength(80));
const SafeOffset = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));

/** A location identifies bytes, address space and decoder mode, not an address alone. */
export const ReverseCodeLocation = Schema.Struct({
  artifactSha256: ReverseDigest,
  addressSpace: Id,
  address: ReverseAddress,
  architecture: Id,
  mode: Schema.optional(Id),
});
export type ReverseCodeLocation = typeof ReverseCodeLocation.Type;

export const ReverseEvidenceRef = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("code"), location: ReverseCodeLocation }),
  Schema.Struct({
    kind: Schema.Literal("capture"), captureId: Id, signal: Schema.optional(Id),
    startNs: Schema.optional(SafeOffset), endNs: Schema.optional(SafeOffset),
  }),
  Schema.Struct({ kind: Schema.Literal("execution"), runId: Id, source: Schema.Literals(["physical", "qemu"]), artifactSha256: ReverseDigest }),
]);
export type ReverseEvidenceRef = typeof ReverseEvidenceRef.Type;

export const ReverseFinding = Schema.Struct({
  id: Id, artifactSha256: ReverseDigest,
  title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000)),
  kind: Schema.Literals(["gadget", "memory-corruption", "attack-surface", "boot-chain", "crypto", "protocol", "other"]),
  status: Schema.Literals(["candidate", "probable", "confirmed", "rejected", "superseded"]),
  authorKind: Schema.Literals(["human", "agent", "analyzer"]),
  analyzerId: Schema.optional(Id), analyzerVersion: Schema.optional(Id),
  evidence: Schema.Array(ReverseEvidenceRef),
});
export type ReverseFinding = typeof ReverseFinding.Type;

export const ReverseInvestigation = Schema.Struct({
  id: Id, projectId: Id, environmentId: Id,
  veritasProjectId: Schema.optional(Id), boardRevisionId: Schema.optional(Id),
  artifactSha256: ReverseDigest, ghidraSessionId: Schema.optional(Id),
});
export type ReverseInvestigation = typeof ReverseInvestigation.Type;
export const ReverseFirmwareArtifact = Schema.Struct({
  sha256: ReverseDigest, sizeBytes: SafeOffset, filename: Id,
  sourcePath: Schema.String.check(Schema.isMaxLength(4096)), importedAt: Id,
});
export type ReverseFirmwareArtifact = typeof ReverseFirmwareArtifact.Type;
export const ReverseListInput = Schema.Struct({ projectId: Id });
export const ReverseListResult = Schema.Struct({ investigations: Schema.Array(ReverseInvestigation), artifacts: Schema.Array(ReverseFirmwareArtifact) });
export const ReverseImportInput = Schema.Struct({ projectId: Id, relativePath: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)) });
export const ReverseImportResult = Schema.Struct({ investigation: ReverseInvestigation, artifact: ReverseFirmwareArtifact });
export const ReverseLinkInput = Schema.Struct({ projectId: Id, investigationId: Id, veritasProjectId: Schema.optional(Id), boardRevisionId: Schema.optional(Id) });
export const ReversePublishInput = Schema.Struct({ projectId: Id, investigationId: Id, boardRevisionId: Schema.optional(Id) });
export const ReversePublishResult = Schema.Struct({ artifactId: Id, sha256: ReverseDigest });
export const ReverseStringsInput = Schema.Struct({
  projectId: Id, investigationId: Id,
  minLength: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 4, maximum: 64 }))),
});
export const ReverseStringsResult = Schema.Struct({ strings: Schema.Array(Schema.Struct({ offset: SafeOffset, value: Schema.String })), truncated: Schema.Boolean });
export class ReverseStoreError extends Schema.TaggedError<ReverseStoreError>()("ReverseStoreError", {
  reason: Schema.Literals(["not_found", "outside_workspace", "too_large", "invalid_file", "unavailable", "operation_failed"]),
  message: Schema.String,
}) {}
