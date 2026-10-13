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
