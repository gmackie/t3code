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
/** A finding as T3 keeps it: tied to one investigation, with when it was recorded and last changed. */
export const ReverseFindingRecord = Schema.Struct({
  ...ReverseFinding.fields,
  investigationId: Id,
  createdAt: Id,
  updatedAt: Id,
  // Who made the last status change, so a reversal is never mistaken for the author's own.
  statusChangedBy: Schema.optional(Schema.Literals(["human", "agent"])),
  // Set once published; Veritas then owns its review.
  veritasFindingId: Schema.optional(Id),
});
export const ReverseFindingPublishInput = Schema.Struct({ projectId: Id, findingId: Id });
/**
 * Read-only Veritas RE queries agents may call through T3 with the environment's token. Veritas's
 * decoders are mutations over raw transition data, so they are not proxied here.
 */
export const VeritasReReadProcedure = Schema.Literals([
  "reBoards.list",
  "reBoards.get",
  "reBoards.listSignals",
  "reBoards.listProbeMaps",
  "reCaptures.list",
  "reCaptures.get",
  "reAnalysis.pulsePresets",
  "reHypotheses.list",
  "reHypotheses.get",
  "reAnnotations.list",
  "reProtocols.list",
  "reFirmware.list",
  "reFirmware.get",
  "reFirmware.listFindings",
  "reFirmware.listExperiments",
]);
export const VeritasReQueryInput = Schema.Struct({
  procedure: VeritasReReadProcedure,
  input: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
export const VeritasReQueryResult = Schema.Struct({ result: Schema.Unknown });
export type ReverseFindingRecord = typeof ReverseFindingRecord.Type;
export const ReverseFindingCreateInput = Schema.Struct({
  projectId: Id,
  investigationId: Id,
  title: ReverseFinding.fields.title,
  kind: ReverseFinding.fields.kind,
  evidence: Schema.Array(ReverseEvidenceRef).check(Schema.isMaxLength(100)),
});
/** Agents may only demote; confirming is a human decision. */
export const ReverseFindingUpdateInput = Schema.Struct({
  projectId: Id,
  findingId: Id,
  status: ReverseFinding.fields.status,
});
export const ReverseInvestigation = Schema.Struct({
  id: Id,
  projectId: Id,
  environmentId: Id,
  veritasProjectId: Schema.optional(Id),
  boardRevisionId: Schema.optional(Id),
  artifactSha256: ReverseDigest,
  ghidraSessionId: Schema.optional(Id),
  // Set when this firmware was extracted from another investigation's.
  parentInvestigationId: Schema.optional(Id),
  // Set once this firmware is registered in Veritas; findings can be published after that.
  veritasArtifactId: Schema.optional(Id),
  // The board revision last synced to Veritas (null: synced as none); unset until then.
  veritasBoardRevisionId: Schema.optional(Schema.NullOr(Id)),
  // How Ghidra loads raw images of this firmware; remembered from the last analysis that set it.
  ghidraProfile: Schema.optional(
    Schema.Struct({ languageId: Schema.optional(Id), imageBase: Schema.optional(Id) }),
  ),
});
export type ReverseInvestigation = typeof ReverseInvestigation.Type;
export const ReverseFirmwareArtifact = Schema.Struct({
  sha256: ReverseDigest,
  sizeBytes: SafeOffset,
  filename: Id,
  sourcePath: Schema.String.check(Schema.isMaxLength(4096)),
  importedAt: Id,
  parentSha256: Schema.optional(ReverseDigest),
});
export type ReverseFirmwareArtifact = typeof ReverseFirmwareArtifact.Type;
/** A logic-analyzer capture imported into a project; its bytes stay on the environment. */
export const ReverseCapture = Schema.Struct({
  id: Id,
  filename: Id,
  sourcePath: Schema.String.check(Schema.isMaxLength(4096)),
  format: Schema.Literals(["vcd", "sigrok", "saleae-binary", "saleae-csv"]),
  sha256: ReverseDigest,
  sizeBytes: SafeOffset,
  importedAt: Id,
  channels: Schema.Array(Schema.String),
  durationNs: Schema.Number,
  sampleRateHz: Schema.NullOr(Schema.Number),
  // More edges than T3 keeps: later ones were dropped.
  truncated: Schema.Boolean,
  // Signals the parser could not read, such as multi-bit VCD vectors.
  skipped: Schema.Array(Schema.String),
});
export type ReverseCapture = typeof ReverseCapture.Type;
export const ReverseListInput = Schema.Struct({ projectId: Id });
export const ReverseListResult = Schema.Struct({
  investigations: Schema.Array(ReverseInvestigation),
  artifacts: Schema.Array(ReverseFirmwareArtifact),
  // Optional so clients still read servers that predate findings.
  findings: Schema.optional(Schema.Array(ReverseFindingRecord)),
  captures: Schema.optional(Schema.Array(ReverseCapture)),
});
export const ReverseCaptureImportInput = Schema.Struct({
  projectId: Id,
  relativePath: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
});
export const ReverseCaptureDeleteInput = Schema.Struct({ projectId: Id, captureId: Id });
const TimeNs = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0));
export const ReverseCaptureViewInput = Schema.Struct({
  projectId: Id,
  captureId: Id,
  startNs: TimeNs,
  endNs: TimeNs,
  // Roughly the drawing width; denser windows come back as busy spans.
  maxPoints: Schema.Int.check(Schema.isBetween({ minimum: 10, maximum: 4000 })),
  // Which channels to return, by name; the first 64 when omitted.
  channels: Schema.optional(Schema.Array(Schema.String).check(Schema.isMaxLength(64))),
});
export const ReverseCaptureViewResult = Schema.Struct({
  startNs: Schema.Number,
  endNs: Schema.Number,
  channels: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      level: Schema.Literals([0, 1]),
      edges: Schema.NullOr(Schema.Array(Schema.Number)),
      busy: Schema.NullOr(Schema.Array(Schema.Tuple([Schema.Number, Schema.Number]))),
    }),
  ),
});
export type ReverseCaptureViewResult = typeof ReverseCaptureViewResult.Type;
const ChannelName = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
export const ReverseCaptureDecoder = Schema.Union([
  Schema.Struct({
    protocol: Schema.Literal("uart"),
    signal: ChannelName,
    baud: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100_000_000 })),
    dataBits: Schema.optional(Schema.Literals([7, 8, 9])),
    parity: Schema.optional(Schema.Literals(["none", "even", "odd"])),
    stopBits: Schema.optional(Schema.Literals([1, 2])),
    inverted: Schema.optional(Schema.Boolean),
  }),
  Schema.Struct({
    protocol: Schema.Literal("spi"),
    clk: ChannelName,
    mosi: Schema.optional(ChannelName),
    miso: Schema.optional(ChannelName),
    cs: Schema.optional(ChannelName),
    cpol: Schema.optional(Schema.Literals([0, 1])),
    cpha: Schema.optional(Schema.Literals([0, 1])),
    wordSize: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 32 }))),
    bitOrder: Schema.optional(Schema.Literals(["msb", "lsb"])),
  }),
  Schema.Struct({ protocol: Schema.Literal("i2c"), sda: ChannelName, scl: ChannelName }),
]);
export type ReverseCaptureDecoder = typeof ReverseCaptureDecoder.Type;
export const ReverseCaptureDecodeInput = Schema.Struct({
  projectId: Id,
  captureId: Id,
  decoder: ReverseCaptureDecoder,
  startNs: Schema.optional(TimeNs),
  endNs: Schema.optional(TimeNs),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 5000 }))),
});
export const ReverseCaptureDecodeResult = Schema.Struct({
  events: Schema.Array(
    Schema.Struct({
      startNs: Schema.Number,
      endNs: Schema.Number,
      text: Schema.String,
      fields: Schema.Record(
        Schema.String,
        Schema.Union([Schema.String, Schema.Number, Schema.Boolean]),
      ),
    }),
  ),
  // The limit was reached before the end of the range.
  truncated: Schema.Boolean,
});
export type ReverseCaptureDecodeResult = typeof ReverseCaptureDecodeResult.Type;
export const ReverseImportInput = Schema.Struct({
  projectId: Id,
  relativePath: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
});
export const ReverseImportResult = Schema.Struct({
  investigation: ReverseInvestigation,
  artifact: ReverseFirmwareArtifact,
});
/** An omitted field is unchanged; null clears it. */
export const ReverseLinkInput = Schema.Struct({
  projectId: Id,
  investigationId: Id,
  veritasProjectId: Schema.optional(Schema.NullOr(Id)),
  boardRevisionId: Schema.optional(Schema.NullOr(Id)),
});
export const ReverseDeleteInput = Schema.Struct({ projectId: Id, investigationId: Id });
export const ReverseDiffInput = Schema.Struct({
  projectId: Id,
  leftInvestigationId: Id,
  rightInvestigationId: Id,
});
const DiffSide = Schema.Struct({ name: Schema.String, address: Schema.String });
/**
 * Function-level comparison of two builds. Relocated functions kept their instructions but moved
 * or changed bytes such as addresses; changed functions run different instructions.
 */
export const ReverseDiffResult = Schema.Struct({
  identical: Schema.Int,
  relocated: Schema.Int,
  changed: Schema.Int,
  added: Schema.Int,
  removed: Schema.Int,
  truncated: Schema.Boolean,
  functions: Schema.Array(
    Schema.Struct({
      status: Schema.Literals(["changed", "relocated", "added", "removed"]),
      left: Schema.optional(DiffSide),
      right: Schema.optional(DiffSide),
    }),
  ),
});
export type ReverseDiffResult = typeof ReverseDiffResult.Type;
/** Opens one file an extraction produced as its own investigation, linked to its parent. */
export const ReverseImportExtractedInput = Schema.Struct({
  projectId: Id,
  investigationId: Id,
  receiptId: Schema.String.check(Schema.isPattern(/^[0-9a-f-]{36}$/)),
  path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
});
export const ReverseToolchainInput = Schema.Struct({});
/** What the environment can run; nothing is executed to find out. */
export const ReverseToolchainResult = Schema.Struct({
  tools: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      label: Schema.String,
      status: Schema.Literals(["ready", "missing", "misconfigured"]),
      detail: Schema.String,
      hint: Schema.String,
      requiredFor: Schema.Array(
        Schema.Literals(["ghidra", "gadgets", "binwalk", "unblob", "rea", "emulate"]),
      ),
    }),
  ),
});
export type ReverseToolchainResult = typeof ReverseToolchainResult.Type;
/** Provenance chosen for an import. Extracted firmware is registered as "extracted" with its parent. */
export const ReverseFirmwareSource = Schema.Literals(["imported", "vendor", "flash-read", "build"]);
export type ReverseFirmwareSource = typeof ReverseFirmwareSource.Type;
export const ReversePublishInput = Schema.Struct({
  projectId: Id,
  investigationId: Id,
  source: ReverseFirmwareSource,
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
