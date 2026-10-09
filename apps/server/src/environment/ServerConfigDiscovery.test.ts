import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";

import * as ExternalLauncher from "../process/externalLauncher.ts";
import * as RemoteOpenTargets from "./RemoteOpenTargets.ts";
import * as ServerConfigDiscovery from "./ServerConfigDiscovery.ts";

it.effect("bounds handshake waiting and shares discovery across reconnects", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const calls = yield* Ref.make(0);
      const started = yield* Deferred.make<void>();
      const finish = yield* Deferred.make<void>();
      const context = yield* Layer.build(
        ServerConfigDiscovery.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                ExternalLauncher.ExternalLauncher,
                ExternalLauncher.ExternalLauncher.of({
                  resolveAvailableEditors: () =>
                    Ref.update(calls, (n) => n + 1).pipe(
                      Effect.andThen(Deferred.succeed(started, undefined)),
                      Effect.andThen(Deferred.await(finish)),
                      Effect.as(["vscode"] as const),
                    ),
                  resolveFileManagerRevealKind: () => Effect.succeed(undefined),
                  launchBrowser: () => Effect.void,
                  launchEditor: () => Effect.void,
                }),
              ),
              Layer.succeed(RemoteOpenTargets.RemoteOpenTargets, {
                resolveTargets: () => Effect.succeed([{ kind: "tailscale", host: "host.ts.net" }]),
              }),
            ),
          ),
        ),
      );
      const discovery = Context.get(context, ServerConfigDiscovery.ServerConfigDiscovery);
      const first = yield* discovery.get.pipe(Effect.forkChild);
      yield* Deferred.await(started);
      const peers = yield* Effect.forEach(Array.from({ length: 8 }), () => discovery.get, {
        concurrency: "unbounded",
      }).pipe(Effect.forkChild);
      yield* TestClock.adjust("1 second");
      assert.deepEqual(yield* Fiber.join(first), {
        availableEditors: [],
        remoteOpenTargets: [],
        fileManagerRevealKind: undefined,
      });
      assert.lengthOf(yield* Fiber.join(peers), 8);
      assert.equal(yield* Ref.get(calls), 1);
      // A timed-out client leaves shared discovery running; later reconnects reuse it.
      yield* Deferred.succeed(finish, undefined);
      const warm = yield* discovery.get;
      assert.deepEqual(warm.availableEditors, ["vscode"]);
      assert.deepEqual(warm.remoteOpenTargets, [{ kind: "tailscale", host: "host.ts.net" }]);
      assert.equal(yield* Ref.get(calls), 1);
      yield* TestClock.adjust("60 seconds");
      assert.deepEqual((yield* discovery.get).availableEditors, ["vscode"]);
      assert.equal(yield* Ref.get(calls), 2);
    }),
  ),
);

it.effect("client cancellation leaves shared discovery bounded and keeps independent results", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const stopped = yield* Deferred.make<void>();
      const context = yield* Layer.build(
        ServerConfigDiscovery.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                ExternalLauncher.ExternalLauncher,
                ExternalLauncher.ExternalLauncher.of({
                  resolveAvailableEditors: () => Effect.succeed(["vscode"] as const),
                  resolveFileManagerRevealKind: () => Effect.succeed(undefined),
                  launchBrowser: () => Effect.void,
                  launchEditor: () => Effect.void,
                }),
              ),
              Layer.succeed(RemoteOpenTargets.RemoteOpenTargets, {
                resolveTargets: () =>
                  Deferred.succeed(started, undefined).pipe(
                    Effect.andThen(Effect.never),
                    Effect.ensuring(Deferred.succeed(stopped, undefined)),
                  ),
              }),
            ),
          ),
        ),
      );
      const discovery = Context.get(context, ServerConfigDiscovery.ServerConfigDiscovery);
      const client = yield* discovery.get.pipe(Effect.forkChild);
      yield* Deferred.await(started);
      yield* Fiber.interrupt(client);
      assert.isFalse(yield* Deferred.isDone(stopped));
      yield* TestClock.adjust("5 seconds");
      yield* Deferred.await(stopped);
      const warmed = yield* discovery.get;
      assert.deepEqual(warmed.availableEditors, ["vscode"]);
      assert.deepEqual(warmed.remoteOpenTargets, []);
    }),
  ),
);
