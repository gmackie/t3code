import type { RemoteOpenTarget } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
export class RemoteOpenTargets extends Context.Service<
  RemoteOpenTargets,
  {
    readonly resolveTargets: () => Effect.Effect<ReadonlyArray<RemoteOpenTarget>>;
  }
>()("t3/environment/RemoteOpenTargets") {}
export const make = Effect.succeed(
  RemoteOpenTargets.of({ resolveTargets: () => Effect.succeed([]) }),
);
export const layer = Layer.effect(RemoteOpenTargets, make);
