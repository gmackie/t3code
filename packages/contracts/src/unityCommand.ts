import * as Schema from "effect/Schema";
import { UnityTarget } from "./unityHooks.ts";

const Name = Schema.String.check(Schema.isPattern(/^[A-Za-z][A-Za-z0-9_:-]{0,127}$/));
const JobId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,128}$/));
export const UnityCommandRequest = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("catalog"),
    target: UnityTarget,
    query: Schema.optional(Schema.String.check(Schema.isMaxLength(128))),
    offset: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 10000 })),
    limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
  }),
  Schema.Struct({
    action: Schema.Literal("submit"),
    target: UnityTarget,
    command: Name,
    parameters: Schema.Record(
      Name,
      Schema.Union([Schema.String.check(Schema.isMaxLength(65536)), Schema.Finite, Schema.Boolean]),
    ),
  }),
  Schema.Struct({
    action: Schema.Literals(["status", "cancel"]),
    target: UnityTarget,
    jobId: JobId,
  }),
]);
export type UnityCommandRequest = typeof UnityCommandRequest.Type;
export const UnityCommandResult = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("catalog"),
    commands: Schema.Array(Schema.Unknown),
    offset: Schema.Int,
  }),
  Schema.Struct({
    action: Schema.Literal("job"),
    jobId: JobId,
    state: Schema.String,
    command: Schema.optional(Schema.String),
    detached: Schema.optional(Schema.Boolean),
    cancellationRequested: Schema.optional(Schema.Boolean),
    result: Schema.optional(Schema.Unknown),
    error: Schema.optional(Schema.Unknown),
    errorDetails: Schema.optional(Schema.Unknown),
    progress: Schema.optional(Schema.Unknown),
  }),
]);
export type UnityCommandResult = typeof UnityCommandResult.Type;
