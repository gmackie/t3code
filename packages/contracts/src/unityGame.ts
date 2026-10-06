import * as Schema from "effect/Schema";
import {
  UnityTarget,
  UnityHookCatalog,
  UnityHookWatch,
  UnityHookValue,
  UnityHookPredicate,
} from "./unityHooks.ts";
import { UnityCommandRequest } from "./unityCommand.ts";
import { ThreadId } from "./baseSchemas.ts";

const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128));
export const GameViewerInput = Schema.Struct({ cwd: Schema.String, threadId: ThreadId });
export const GameViewerTicket = Schema.Struct({
  token: Id,
  expiresAt: Schema.Number,
  canOperate: Schema.Boolean,
});
export const GameRequest = Schema.Union([
  Schema.Struct({ action: Schema.Literal("cli"), request: UnityCommandRequest }),
  Schema.Struct({ action: Schema.Literal("open"), target: UnityTarget }),
  Schema.Struct({
    action: Schema.Literal("state"),
    sessionId: Id,
    afterSequence: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  }),
  Schema.Struct({ action: Schema.Literal("close"), sessionId: Id }),
  Schema.Struct({ action: Schema.Literal("acquire"), sessionId: Id, takeover: Schema.Boolean }),
  Schema.Struct({ action: Schema.Literal("release"), sessionId: Id, lease: Id }),
  Schema.Struct({
    action: Schema.Literal("input"),
    sessionId: Id,
    lease: Id,
    sequence: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    keys: Schema.Array(Schema.String.check(Schema.isMaxLength(32))).check(Schema.isMaxLength(16)),
    x: Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
    y: Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
    button: Schema.Boolean,
    look: Schema.optional(
      Schema.Struct({
        x: Schema.Finite.check(Schema.isBetween({ minimum: -1000, maximum: 1000 })),
        y: Schema.Finite.check(Schema.isBetween({ minimum: -1000, maximum: 1000 })),
      }),
    ),
    gamepad: Schema.optional(
      Schema.Struct({
        leftX: Schema.Finite.check(Schema.isBetween({ minimum: -1, maximum: 1 })),
        leftY: Schema.Finite.check(Schema.isBetween({ minimum: -1, maximum: 1 })),
        rightX: Schema.Finite.check(Schema.isBetween({ minimum: -1, maximum: 1 })),
        rightY: Schema.Finite.check(Schema.isBetween({ minimum: -1, maximum: 1 })),
        leftTrigger: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
        rightTrigger: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
        buttons: Schema.Array(
          Schema.Literals([
            "South",
            "East",
            "West",
            "North",
            "LeftShoulder",
            "RightShoulder",
            "LeftStick",
            "RightStick",
            "Start",
            "Select",
            "DpadUp",
            "DpadDown",
            "DpadLeft",
            "DpadRight",
          ]),
        ).check(Schema.isMaxLength(14)),
      }),
    ),
    durationMs: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 })),
  }),
  Schema.Struct({
    action: Schema.Literal("write"),
    sessionId: Id,
    lease: Id,
    handle: Id,
    value: UnityHookValue,
    expected: UnityHookValue,
  }),
  Schema.Struct({
    action: Schema.Literal("monitor"),
    predicate: Schema.optional(UnityHookPredicate),
    sessionId: Id,
    lease: Id,
    handles: Schema.Array(Id).check(Schema.isMinLength(1), Schema.isMaxLength(32)),
    durationMs: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 60000 })),
  }),
  Schema.Struct({ action: Schema.Literal("rearm_monitor"), sessionId: Id, lease: Id }),
  Schema.Struct({ action: Schema.Literal("stop_monitor"), sessionId: Id, lease: Id }),
  Schema.Struct({ action: Schema.Literal("report"), sessionId: Id }),
]);
export type GameRequest = typeof GameRequest.Type;
export const GameState = Schema.Struct({
  generation: Id,
  controller: Schema.Struct({
    owner: Schema.NullOr(Id),
    role: Schema.NullOr(Schema.Literals(["human", "agent"])),
  }),
  monitor: Schema.NullOr(UnityHookWatch),
  width: Schema.Int,
  height: Schema.Int,
  frameAgeMs: Schema.Number,
});
export type GameState = typeof GameState.Type;
export const GameCatalog = Schema.Struct({
  generation: Id,
  target: Schema.Literals(["editor", "player"]),
  hooks: UnityHookCatalog.fields.hooks,
});
export type GameCatalog = typeof GameCatalog.Type;
