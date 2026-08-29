import { it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";
import { describe, expect } from "vite-plus/test";

import { withCodexImportTimeout } from "./CodexThreadImportClient.ts";

describe("CodexThreadImportClient", () => {
  it.effect("times out a hung request and releases its scoped process resource", () =>
    Effect.gen(function* () {
      const released = yield* Ref.make(false);
      const hung = Effect.scoped(
        Effect.acquireRelease(Effect.void, () => Ref.set(released, true)).pipe(
          Effect.andThen(Effect.never),
        ),
      );

      const fiber = yield* Effect.forkChild(withCodexImportTimeout(hung, Duration.millis(5)));
      yield* TestClock.adjust(Duration.millis(5));
      const exit = yield* Fiber.await(fiber);

      expect(exit._tag).toBe("Failure");
      expect(yield* Ref.get(released)).toBe(true);
    }),
  );
});
