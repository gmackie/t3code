import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as NetService from "@t3tools/shared/Net";
import { findDesktopBackendPort } from "./DesktopBackendPort.ts";

it.effect("skips a default port that already has a listener", () =>
  Effect.gen(function* () {
    const selection = yield* findDesktopBackendPort({
      startPort: 3_773,
      maxPort: 3_774,
      hosts: ["127.0.0.1", "0.0.0.0", "::"],
    });

    assert.deepEqual(selection, Option.some(3_774));
  }).pipe(
    Effect.provide(
      Layer.succeed(NetService.NetService, {
        canListenOnHost: () => Effect.succeed(true),
        hasListenerOnHost: () => Effect.succeed(false),
        isPortAvailableOnLoopback: (port) => Effect.succeed(port !== 3_773),
        reserveLoopbackPort: () => Effect.succeed(3_774),
        findAvailablePort: () => Effect.succeed(3_774),
      }),
    ),
  ),
);
