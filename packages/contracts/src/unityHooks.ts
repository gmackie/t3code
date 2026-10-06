import * as Schema from "effect/Schema";

const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128));
export const UnityHookValue = Schema.Union([
  Schema.Array(Schema.Finite).check(Schema.isMinLength(2), Schema.isMaxLength(4)),
  Schema.Boolean,
  Schema.Number.check(Schema.isFinite()),
  Schema.String.check(Schema.isMaxLength(1024)),
]);
const Handles = Schema.Array(Id).check(Schema.isMinLength(1), Schema.isMaxLength(32));
export const UnityTarget = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("editor"), projectPath: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("player"), portFile: Schema.String }),
]);
const Bound = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
export type UnityTarget = typeof UnityTarget.Type;
const base = { target: UnityTarget };
const session = { ...base, generation: Id };

export const UnityHookRequest = Schema.Union([
  Schema.Struct({ ...base, action: Schema.Literal("list") }),
  Schema.Struct({ ...session, action: Schema.Literal("read"), handles: Handles }),
  Schema.Struct({
    ...session,
    action: Schema.Literal("write"),
    handle: Id,
    value: UnityHookValue,
    expected: Schema.optional(UnityHookValue),
  }),
  Schema.Struct({
    ...session,
    action: Schema.Literal("assert"),
    handle: Id,
    expected: UnityHookValue,
  }),
  Schema.Struct({
    ...session,
    action: Schema.Literal("watch"),
    handles: Handles,
    durationMs: Bound.check(Schema.isBetween({ minimum: 1, maximum: 60000 })),
    intervalMs: Bound.check(Schema.isBetween({ minimum: 50, maximum: 10000 })),
  }),
  Schema.Struct({ ...session, action: Schema.Literal("watch_read"), id: Id, afterSequence: Bound }),
  Schema.Struct({
    ...session,
    action: Schema.Literal("watch_stop"),
    id: Id,
    forget: Schema.Boolean,
  }),
]);
export type UnityHookRequest = typeof UnityHookRequest.Type;

export const UnityHookSample = Schema.Struct({
  generation: Id,
  sequence: Bound,
  sampledAtMs: Schema.Number.check(Schema.isFinite()),
  values: Schema.Record(Id, UnityHookValue),
});
export const UnityHookCatalog = Schema.Struct({
  schema: Schema.Literal("gmacko.agent-hooks/v1"),
  generation: Id,
  target: Schema.Literals(["editor", "player"]),
  hooks: Schema.Array(
    Schema.Struct({
      key: Id,
      handle: Id,
      type: Schema.Literals(["boolean", "integer", "number", "string", "enum", "vector"]),
      choices: Schema.optional(
        Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))).check(
          Schema.isMinLength(1),
          Schema.isMaxLength(64),
        ),
      ),
      components: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 4 }))),
      description: Schema.String,
      unit: Schema.NullOr(Schema.String),
      writable: Schema.Boolean,
      minimum: Schema.NullOr(Schema.Number),
      maximum: Schema.NullOr(Schema.Number),
    }),
  ).check(Schema.isMaxLength(256)),
});
export const UnityHookWatch = Schema.Struct({
  id: Id,
  generation: Id,
  status: Schema.Literals(["active", "expired", "stopped", "failed"]),
  error: Schema.NullOr(Schema.String),
  dropped: Bound,
  samples: Schema.Array(UnityHookSample).check(Schema.isMaxLength(256)),
});
export const UnityHookAssertion = Schema.Struct({
  passed: Schema.Boolean,
  sample: UnityHookSample,
});
export const UnityHookResult = Schema.Union([
  UnityHookCatalog,
  UnityHookSample,
  UnityHookWatch,
  UnityHookAssertion,
]);
export type UnityHookResult = typeof UnityHookResult.Type;

export class UnityHookError extends Schema.TaggedError<UnityHookError>()("UnityHookError", {
  code: Schema.String,
  reason: Schema.String,
}) {
  override get message() {
    return this.reason;
  }
}

export const UnityBridgeConnection = Schema.Struct({
  generation: Id,
  port: Schema.Int.check(Schema.isBetween({ minimum: 1024, maximum: 65535 })),
  token: Schema.String.check(Schema.isMinLength(32), Schema.isMaxLength(128)),
  protocol: Schema.Literal(1),
});
export type UnityBridgeConnection = typeof UnityBridgeConnection.Type;
