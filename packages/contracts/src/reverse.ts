import * as Schema from "effect/Schema";

/** Immutable code coordinates. Never identify an instruction by address alone. */
export const ReverseCodeLocation = Schema.Struct({
  artifactSha256: Schema.String,
  addressSpace: Schema.String,
  address: Schema.String,
  architecture: Schema.String,
  mode: Schema.optional(Schema.String),
});
export type ReverseCodeLocation = typeof ReverseCodeLocation.Type;

export const ReverseEvidenceRef = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("code"), location: ReverseCodeLocation }),
  Schema.Struct({ kind: Schema.Literal("capture"), captureId: Schema.String, signal: Schema.optional(Schema.String), startNs: Schema.optional(Schema.Number), endNs: Schema.optional(Schema.Number) }),
  Schema.Struct({ kind: Schema.Literal("execution"), runId: Schema.String, source: Schema.Literals(["physical", "qemu"]), artifactSha256: Schema.String }),
);
export type ReverseEvidenceRef = typeof ReverseEvidenceRef.Type;

export const ReverseFinding = Schema.Struct({
  id: Schema.String,
  artifactSha256: Schema.String,
  title: Schema.String,
  kind: Schema.Literals(["gadget", "memory-corruption", "attack-surface", "boot-chain", "crypto", "protocol", "other"]),
  status: Schema.Literals(["candidate", "probable", "confirmed", "rejected", "superseded"]),
  authorKind: Schema.Literals(["human", "agent", "analyzer"]),
  analyzerId: Schema.optional(Schema.String),
  analyzerVersion: Schema.optional(Schema.String),
  evidence: Schema.Array(ReverseEvidenceRef),
});
export type ReverseFinding = typeof ReverseFinding.Type;

export const ReverseInvestigation = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  environmentId: Schema.String,
  veritasProjectId: Schema.optional(Schema.String),
  boardRevisionId: Schema.optional(Schema.String),
  artifactSha256: Schema.String,
  ghidraSessionId: Schema.optional(Schema.String),
});
export type ReverseInvestigation = typeof ReverseInvestigation.Type;

/** Workspace-local acquisition metadata; raw bytes are not transported over RPC. */
export const ReverseFirmwareArtifact = Schema.Struct({
  sha256: Schema.String,
  sizeBytes: Schema.Number,
  filename: Schema.String,
  sourcePath: Schema.String,
  importedAt: Schema.String,
});
export type ReverseFirmwareArtifact = typeof ReverseFirmwareArtifact.Type;

export const ReverseListInput = Schema.Struct({ projectId: Schema.String });
export const ReverseListResult = Schema.Struct({
  investigations: Schema.Array(ReverseInvestigation),
  artifacts: Schema.Array(ReverseFirmwareArtifact),
});
export const ReverseImportInput = Schema.Struct({
  projectId: Schema.String,
  relativePath: Schema.String.check(Schema.isMaxLength(4096)),
});
export const ReverseImportResult = Schema.Struct({
  investigation: ReverseInvestigation,
  artifact: ReverseFirmwareArtifact,
});
export const ReverseLinkInput = Schema.Struct({
  projectId: Schema.String,
  investigationId: Schema.String,
  veritasProjectId: Schema.optional(Schema.String),
  boardRevisionId: Schema.optional(Schema.String),
});
export const ReversePublishInput = Schema.Struct({
  projectId: Schema.String,
  investigationId: Schema.String,
  boardRevisionId: Schema.optional(Schema.String),
});
export const ReversePublishResult = Schema.Struct({
  artifactId: Schema.String,
  sha256: Schema.String,
});
export const ReverseStringsInput = Schema.Struct({
  projectId: Schema.String,
  investigationId: Schema.String,
  minLength: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 4, maximum: 64 }))),
});
export const ReverseStringsResult = Schema.Struct({
  strings: Schema.Array(Schema.Struct({
    offset: Schema.Number,
    value: Schema.String,
  })),
  truncated: Schema.Boolean,
});

export class ReverseStoreError extends Schema.TaggedError<ReverseStoreError>()(
  "ReverseStoreError",
  {
    reason: Schema.Literals([
      "not_found", "outside_workspace", "too_large", "invalid_file",
      "unavailable", "operation_failed",
    ]),
    message: Schema.String,
  },
) {}

/** Native tool invocation is explicit and bounded by the environment host. */
export const ReverseAnalysisInput = Schema.Struct({
  projectId: Schema.String,
  investigationId: Schema.String,
  kind: Schema.Literals(["ghidra", "binwalk", "gadgets", "unblob"]),
  rawArch: Schema.optional(Schema.Literals(["x86", "arm", "arm64", "mips", "riscv"])),
  rawMode: Schema.optional(Schema.Literals(["32", "64", "arm", "thumb"])),
});
export const ReverseAnalysisResult = Schema.Struct({
  kind: Schema.Literals(["ghidra", "binwalk", "gadgets"]),
  output: Schema.String,
  truncated: Schema.Boolean,
  toolVersion: Schema.optional(Schema.String),
  functions: Schema.optional(Schema.Array(Schema.Struct({
    address: Schema.String,
    name: Schema.String,
    pseudocode: Schema.String,
    instructions: Schema.Array(Schema.Struct({ address: Schema.String, text: Schema.String })),
  }))),
  extracted: Schema.optional(Schema.Array(Schema.Struct({ path: Schema.String, bytes: Schema.Number }))),
  gadgets: Schema.optional(Schema.Array(Schema.Struct({
    address: Schema.String,
    instructions: Schema.String,
    kind: Schema.Literals(["rop", "jop", "cop", "other"]),
  }))),
});
export const ReverseEmulateInput = Schema.Struct({
  projectId: Schema.String,
  investigationId: Schema.String,
  machine: Schema.Literals(["lm3s6965evb", "mps2-an385"]),
});
export const ReverseEmulateResult = Schema.Struct({
  source: Schema.Literal("qemu"),
  outcome: Schema.Literals(["inconclusive", "error"]),
  output: Schema.String,
});
