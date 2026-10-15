import * as Schema from "effect/Schema";
const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
export const ReverseDigest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
export const ReverseAddress = Schema.String.check(
  Schema.isPattern(/^(?:0x[0-9a-fA-F]+|[0-9]+)$/),
  Schema.isMaxLength(80),
);
const SafeOffset = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
);
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
    kind: Schema.Literal("capture"),
    captureId: Id,
    signal: Schema.optional(Id),
    startNs: Schema.optional(SafeOffset),
    endNs: Schema.optional(SafeOffset),
  }),
  Schema.Struct({
    kind: Schema.Literal("execution"),
    runId: Id,
    source: Schema.Literals(["physical", "qemu"]),
    artifactSha256: ReverseDigest,
  }),
]);
export type ReverseEvidenceRef = typeof ReverseEvidenceRef.Type;
export const ReverseFinding = Schema.Struct({
  id: Id,
  artifactSha256: ReverseDigest,
  title: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2000)),
  kind: Schema.Literals([
    "gadget",
    "memory-corruption",
    "attack-surface",
    "boot-chain",
    "crypto",
    "protocol",
    "other",
  ]),
  status: Schema.Literals(["candidate", "probable", "confirmed", "rejected", "superseded"]),
  authorKind: Schema.Literals(["human", "agent", "analyzer"]),
  analyzerId: Schema.optional(Id),
  analyzerVersion: Schema.optional(Id),
  evidence: Schema.Array(ReverseEvidenceRef),
});
export type ReverseFinding = typeof ReverseFinding.Type;
export const ReverseInvestigation = Schema.Struct({
  id: Id,
  projectId: Id,
  environmentId: Id,
  veritasProjectId: Schema.optional(Id),
  boardRevisionId: Schema.optional(Id),
  artifactSha256: ReverseDigest,
  ghidraSessionId: Schema.optional(Id),
});
export type ReverseInvestigation = typeof ReverseInvestigation.Type;
export const ReverseFirmwareArtifact = Schema.Struct({
  sha256: ReverseDigest,
  sizeBytes: SafeOffset,
  filename: Id,
  sourcePath: Schema.String.check(Schema.isMaxLength(4096)),
  importedAt: Id,
});
export type ReverseFirmwareArtifact = typeof ReverseFirmwareArtifact.Type;
export const ReverseListInput = Schema.Struct({ projectId: Id });
export const ReverseListResult = Schema.Struct({
  investigations: Schema.Array(ReverseInvestigation),
  artifacts: Schema.Array(ReverseFirmwareArtifact),
});
export const ReverseImportInput = Schema.Struct({
  projectId: Id,
  relativePath: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
});
export const ReverseImportResult = Schema.Struct({
  investigation: ReverseInvestigation,
  artifact: ReverseFirmwareArtifact,
});
export const ReverseLinkInput = Schema.Struct({
  projectId: Id,
  investigationId: Id,
  veritasProjectId: Schema.optional(Id),
  boardRevisionId: Schema.optional(Id),
});
export const ReversePublishInput = Schema.Struct({
  projectId: Id,
  investigationId: Id,
  source: Schema.Literals(["imported", "vendor", "flash-read", "build"]),
});
export const ReversePublishResult = Schema.Struct({ artifactId: Id, sha256: ReverseDigest });
export const ReverseStringsInput = Schema.Struct({
  projectId: Id,
  investigationId: Id,
  minLength: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 4, maximum: 64 }))),
});
export const ReverseStringsResult = Schema.Struct({
  strings: Schema.Array(Schema.Struct({ offset: SafeOffset, value: Schema.String })),
  truncated: Schema.Boolean,
});
export class ReverseStoreError extends Schema.TaggedError<ReverseStoreError>()(
  "ReverseStoreError",
  {
    reason: Schema.Literals([
      "not_found",
      "outside_workspace",
      "too_large",
      "invalid_file",
      "unavailable",
      "operation_failed",
    ]),
    message: Schema.String,
  },
) {}
// Ghidra addresses are hexadecimal; code locations also accept decimal for Veritas.
const ReverseHexAddress = Schema.String.check(
  Schema.isPattern(/^0x[0-9a-fA-F]+$/),
  Schema.isMaxLength(80),
);
export const ReverseGhidraOperation = Schema.Struct({
  action: Schema.optional(
    Schema.Literals(["list", "function", "rename", "comment", "save", "close"]),
  ),
  languageId: Schema.optional(Id),
  imageBase: Schema.optional(ReverseHexAddress),
  address: Schema.optional(ReverseHexAddress),
  name: Schema.optional(Id),
  expectedName: Schema.optional(Id),
  comment: Schema.optional(Schema.String.check(Schema.isMaxLength(8192))),
  cursor: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 1000000 }))),
});
export type ReverseGhidraOperation = typeof ReverseGhidraOperation.Type;
export const ReverseAnalysisKind = Schema.Literals([
  "ghidra",
  "binwalk",
  "gadgets",
  "unblob",
  "rea",
  "posture",
]);
export const ReverseAnalysisInput = Schema.Struct({
  projectId: Id,
  investigationId: Id,
  kind: ReverseAnalysisKind,
  rawArch: Schema.optional(Schema.Literals(["x86", "arm", "arm64", "mips", "riscv"])),
  rawMode: Schema.optional(Schema.Literals(["32", "64", "arm", "thumb"])),
  rawEndian: Schema.optional(Schema.Literals(["little", "big"])),
  ghidra: Schema.optional(ReverseGhidraOperation),
});
export type ReverseAnalysisInput = typeof ReverseAnalysisInput.Type;
export const ReverseGhidraFunction = Schema.Struct({
  address: Schema.String,
  name: Schema.String,
  pseudocode: Schema.String,
  instructions: Schema.Array(
    Schema.Struct({
      address: Schema.String,
      text: Schema.String,
      bytes: Schema.optional(Schema.String),
    }),
  ),
  tokens: Schema.optional(
    Schema.Array(
      Schema.Struct({
        text: Schema.String,
        address: Schema.optional(Schema.String),
        syntaxType: Schema.Int,
      }),
    ),
  ),
  callees: Schema.optional(
    Schema.Array(Schema.Struct({ address: Schema.String, name: Schema.String })),
  ),
  xrefs: Schema.optional(
    Schema.Array(Schema.Struct({ address: Schema.String, type: Schema.String })),
  ),
});
export type ReverseGhidraFunction = typeof ReverseGhidraFunction.Type;
export const ReverseAnalysisResult = Schema.Struct({
  kind: ReverseAnalysisKind,
  output: Schema.String,
  truncated: Schema.Boolean,
  toolVersion: Schema.optional(Schema.String),
  receiptId: Schema.optional(Id),
  nextCursor: Schema.optional(SafeOffset),
  functions: Schema.optional(Schema.Array(ReverseGhidraFunction)),
  extracted: Schema.optional(
    Schema.Array(
      Schema.Struct({
        path: Schema.String,
        bytes: SafeOffset,
        sha256: Schema.optional(ReverseDigest),
      }),
    ),
  ),
  gadgets: Schema.optional(
    Schema.Array(
      Schema.Struct({
        address: Schema.String,
        instructions: Schema.String,
        kind: Schema.Literals(["rop", "jop", "cop", "other"]),
        classification: Schema.optional(Schema.Literal("syntactic")),
        effects: Schema.optional(Schema.Literal("not-modeled")),
      }),
    ),
  ),
});
export type ReverseAnalysisResult = typeof ReverseAnalysisResult.Type;
export const ReverseEmulateInput = Schema.Struct({
  projectId: Id,
  investigationId: Id,
  machine: Schema.Literals(["lm3s6965evb", "mps2-an385"]),
});
export const ReverseEmulateResult = Schema.Struct({
  source: Schema.Literal("qemu"),
  outcome: Schema.Literals(["inconclusive", "error"]),
  output: Schema.String,
  receiptId: Schema.optional(Id),
  timedOut: Schema.optional(Schema.Boolean),
});
export type ReverseEmulateResult = typeof ReverseEmulateResult.Type;
