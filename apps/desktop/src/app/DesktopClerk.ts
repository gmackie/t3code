import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export const desktopClerkFrontendApiHostname: string | undefined = undefined;
export class DesktopClerk extends Context.Service<
  DesktopClerk,
  {
    readonly configure: Effect.Effect<void>;
  }
>()("@t3tools/desktop/app/DesktopClerk") {}
export const layer = Layer.succeed(DesktopClerk, { configure: Effect.void });
