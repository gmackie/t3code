import type {
  DesktopUpdateState,
  DesktopUpdateChannel,
  DesktopUpdateCheckResult,
  DesktopUpdateActionResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import { createInitialDesktopUpdateState } from "./updateMachine.ts";

export type DesktopUpdateConfigureError = never;
export type DesktopUpdateSetChannelError = never;
export interface DesktopPreparedUpdateInstallResult extends DesktopUpdateActionResult {
  readonly failed: boolean;
}

export class DesktopUpdates extends Context.Service<
  DesktopUpdates,
  {
    readonly getState: Effect.Effect<DesktopUpdateState>;
    /** True while a check, download, install, or channel change holds the
        updater's single action reservation. */
    readonly isActionActive: Effect.Effect<boolean>;
    /** True only while an install owns the updater action reservation. */
    readonly isInstallActive: Effect.Effect<boolean>;
    /** Current state plus a stream of every later state change. */
    readonly subscribe: Effect.Effect<
      {
        readonly latest: DesktopUpdateState;
        readonly changes: Stream.Stream<DesktopUpdateState>;
      },
      never,
      Scope.Scope
    >;
    readonly emitState: Effect.Effect<void>;
    readonly disabledReason: Effect.Effect<Option.Option<string>>;
    readonly configure: Effect.Effect<void, DesktopUpdateConfigureError, Scope.Scope>;
    readonly setChannel: (
      channel: DesktopUpdateChannel,
    ) => Effect.Effect<DesktopUpdateState, DesktopUpdateSetChannelError>;
    readonly check: (reason: string) => Effect.Effect<DesktopUpdateCheckResult>;
    readonly download: Effect.Effect<DesktopUpdateActionResult>;
    readonly install: Effect.Effect<DesktopUpdateActionResult>;
    readonly installPrepared: (
      expectedVersion: string,
    ) => Effect.Effect<DesktopPreparedUpdateInstallResult>;
  }
>()("@t3tools/desktop/updates/DesktopUpdates") {}

const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const state: DesktopUpdateState = {
    ...createInitialDesktopUpdateState(environment.appVersion, environment.runtimeInfo, "latest"),
    enabled: false,
    status: "disabled",
  };
  const disabled = { accepted: false, completed: false, state };
  return DesktopUpdates.of({
    getState: Effect.succeed(state),
    isActionActive: Effect.succeed(false),
    isInstallActive: Effect.succeed(false),
    subscribe: Effect.succeed({ latest: state, changes: Stream.empty }),
    emitState: Effect.void,
    disabledReason: Effect.succeed(Option.some("Updates are managed by your administrator.")),
    configure: Effect.void,
    setChannel: () => Effect.succeed(state),
    check: () => Effect.succeed({ checked: false, state }),
    download: Effect.succeed(disabled),
    install: Effect.succeed(disabled),
    installPrepared: () => Effect.succeed({ ...disabled, failed: true }),
  });
});
export const layer = Layer.effect(DesktopUpdates, make);
