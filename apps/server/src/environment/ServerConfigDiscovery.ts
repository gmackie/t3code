import type { EditorId, FileManagerRevealKind, RemoteOpenTarget } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ExternalLauncher from "../process/externalLauncher.ts";
import * as RemoteOpenTargets from "./RemoteOpenTargets.ts";

interface Discovery {
  readonly availableEditors: ReadonlyArray<EditorId>;
  readonly remoteOpenTargets: ReadonlyArray<RemoteOpenTarget>;
  readonly fileManagerRevealKind: FileManagerRevealKind | undefined;
}

const EMPTY_DISCOVERY: Discovery = {
  availableEditors: [],
  remoteOpenTargets: [],
  fileManagerRevealKind: undefined,
};

export class ServerConfigDiscovery extends Context.Service<
  ServerConfigDiscovery,
  { readonly get: Effect.Effect<Discovery> }
>()("t3/environment/ServerConfigDiscovery") {}

const make = Effect.gen(function* () {
  const launcher = yield* ExternalLauncher.ExternalLauncher;
  const remote = yield* RemoteOpenTargets.RemoteOpenTargets;
  const scope = yield* Effect.scope;
  const discover = Effect.all(
    {
      editor: Effect.gen(function* () {
        const availableEditors = yield* launcher
          .resolveAvailableEditors()
          .pipe(
            Effect.timeoutOption("5 seconds"),
            Effect.map(Option.getOrElse(() => EMPTY_DISCOVERY.availableEditors)),
          );
        const fileManagerRevealKind = availableEditors.includes("file-manager")
          ? yield* launcher
              .resolveFileManagerRevealKind()
              .pipe(
                Effect.timeoutOption("5 seconds"),
                Effect.map(Option.getOrElse(() => undefined)),
              )
          : undefined;
        return { availableEditors, fileManagerRevealKind };
      }),
      remoteOpenTargets: remote
        .resolveTargets()
        .pipe(
          Effect.timeoutOption("5 seconds"),
          Effect.map(Option.getOrElse(() => EMPTY_DISCOVERY.remoteOpenTargets)),
        ),
    },
    { concurrency: 2 },
  ).pipe(
    Effect.map(({ editor, remoteOpenTargets }): Discovery => ({ ...editor, remoteOpenTargets })),
  );
  // Cache the shared fiber, not a caller's Exit. A disconnect or short handshake
  // budget must neither cancel discovery nor cache an interruption for later clients.
  const shared = yield* Effect.cachedWithTTL(discover.pipe(Effect.forkIn(scope)), "60 seconds");
  const get = Effect.gen(function* () {
    const fiber = yield* shared;
    return yield* Fiber.join(fiber).pipe(
      Effect.timeoutOption("1 second"),
      Effect.map(Option.getOrElse(() => EMPTY_DISCOVERY)),
    );
  });
  return ServerConfigDiscovery.of({ get });
});

export const layer = Layer.effect(ServerConfigDiscovery, make);
