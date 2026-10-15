import * as Schema from "effect/Schema";

const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
const Address = Schema.String.check(
  Schema.isPattern(/^(?:0x[0-9a-fA-F]+|[0-9]+)$/),
  Schema.isMaxLength(80),
);
const scope = { projectId: Id, investigationId: Id };
const count = (maximum: number) => Schema.Int.check(Schema.isBetween({ minimum: 1, maximum }));

/** Only these operations cross the boundary. No shell, executable path, URL or arbitrary GDB command is accepted. */
export const ReverseWorkbenchRequest = Schema.Union([
  Schema.Struct({ ...scope, operation: Schema.Literal("status") }),
  Schema.Struct({
    ...scope,
    operation: Schema.Literal("bytes"),
    offset: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
    length: count(4096),
  }),
  Schema.Struct({ ...scope, operation: Schema.Literal("publish") }),
  Schema.Struct({
    ...scope,
    operation: Schema.Literal("scan"),
    engine: Schema.Literals(["strings", "posture", "gadgets", "binwalk", "unblob", "rea"]),
    minLength: Schema.optional(count(128)),
    encoding: Schema.optional(Schema.Literals(["ascii", "utf16le", "utf16be"])),
    depth: Schema.optional(count(20)),
    architecture: Schema.optional(
      Schema.Literals(["x86", "x86_64", "arm", "arm64", "mips", "riscv"]),
    ),
    mode: Schema.optional(Schema.Literals(["arm", "thumb", "32", "64"])),
    endian: Schema.optional(Schema.Literals(["little", "big"])),
  }),
  Schema.Struct({
    ...scope,
    operation: Schema.Literal("analysis"),
    action: Schema.Literals([
      "open",
      "functions",
      "decompile",
      "disassemble",
      "references",
      "graph",
      "rename",
      "comment",
      "save",
      "close",
    ]),
    address: Schema.optional(Address),
    language: Schema.optional(Id),
    compiler: Schema.optional(Id),
    imageBase: Schema.optional(Address),
    name: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))),
    comment: Schema.optional(Schema.String.check(Schema.isMaxLength(16000))),
    offset: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10000000 }))),
    limit: Schema.optional(count(500)),
  }),
  Schema.Struct({ ...scope, operation: Schema.Literals(["job", "cancel"]), jobId: Id }),
  Schema.Struct({
    ...scope,
    operation: Schema.Literal("emulator"),
    action: Schema.Literals(["start", "status", "stop"]),
    profile: Schema.optional(
      Schema.Literals(["cortex-m3-lm3s6965evb", "linux-arm", "linux-aarch64", "linux-mipsel"]),
    ),
    sessionId: Schema.optional(Id),
  }),
  Schema.Struct({
    ...scope,
    operation: Schema.Literal("lab"),
    action: Schema.Literals(["catalog", "arm", "open", "poll", "command", "close", "acquire"]),
    targetId: Schema.optional(Id),
    sessionId: Schema.optional(Id),
    leaseToken: Schema.optional(Id),
    approvalToken: Schema.optional(Id),
    acknowledgement: Schema.optional(
      Schema.Literal("I understand this can halt or reset the target"),
    ),
    transport: Schema.optional(Schema.Literals(["serial", "gdb"])),
    command: Schema.optional(
      Schema.Literals([
        "interrupt",
        "continue",
        "step",
        "next",
        "registers",
        "stack",
        "threads",
        "breakpoint",
        "remove-breakpoint",
        "read-memory",
        "serial-write",
      ]),
    ),
    address: Schema.optional(Address),
    length: Schema.optional(count(16777216)),
    dataHex: Schema.optional(
      Schema.String.check(Schema.isPattern(/^(?:[0-9a-fA-F]{2})*$/), Schema.isMaxLength(8192)),
    ),
    breakpointId: Schema.optional(Schema.String.check(Schema.isPattern(/^[0-9]+(?:\.[0-9]+)?$/))),
    cursor: Schema.optional(
      Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
    ),
  }),
]);
export type ReverseWorkbenchRequest = typeof ReverseWorkbenchRequest.Type;
export const ReverseWorkbenchReply = Schema.Struct({
  protocolVersion: Schema.Literal(1),
  operation: Schema.String,
  artifactSha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  data: Schema.Unknown,
});
export type ReverseWorkbenchReply = typeof ReverseWorkbenchReply.Type;
export class ReverseWorkbenchError extends Schema.TaggedError<ReverseWorkbenchError>()(
  "ReverseWorkbenchError",
  {
    code: Schema.String,
    message: Schema.String,
  },
) {}

export function reverseOperationMutates(request: ReverseWorkbenchRequest): boolean {
  return !(
    request.operation === "status" ||
    request.operation === "bytes" ||
    request.operation === "job" ||
    (request.operation === "lab" && (request.action === "catalog" || request.action === "poll")) ||
    (request.operation === "emulator" && request.action === "status")
  );
}
