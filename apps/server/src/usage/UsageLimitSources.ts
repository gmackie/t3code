import type {
  UsageLimitSourceSnapshot,
  UsageLimitSourceConsumeResetCreditInput,
  ProviderConsumeResetCreditResult,
  UsageLimitSourceError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

export class UsageLimitSources extends Context.Service<
  UsageLimitSources,
  {
    readonly current: Effect.Effect<ReadonlyArray<UsageLimitSourceSnapshot>>;
    /** The current set followed by every change, with repeats dropped. */
    readonly streamChanges: Stream.Stream<ReadonlyArray<UsageLimitSourceSnapshot>>;
    /** Re-read every source now. Never fails; failures land on the snapshot. */
    readonly refresh: Effect.Effect<void>;
    readonly consumeResetCredit: (
      input: UsageLimitSourceConsumeResetCreditInput,
    ) => Effect.Effect<ProviderConsumeResetCreditResult, UsageLimitSourceError>;
  }
>()("t3/usage/UsageLimitSources") {}

export const layer = Layer.succeed(UsageLimitSources, {
  current: Effect.succeed([]),
  streamChanges: Stream.succeed([]),
  refresh: Effect.void,
  consumeResetCredit: () => Effect.succeed({ outcome: "noCredit" }),
});
