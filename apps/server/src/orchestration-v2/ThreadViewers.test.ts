import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";

import * as ThreadViewers from "./ThreadViewers.ts";

describe("ThreadViewers", () => {
  it.effect("counts a thread as shown while a client streams it, and briefly after", () =>
    Effect.gen(function* () {
      const viewers = yield* ThreadViewers.make;
      const viewed = Effect.map(viewers.viewed, (threads) => [...threads].toSorted());
      const subscribe = Effect.fn(function* (threadId: string) {
        const started = yield* Deferred.make<void>();
        const fiber = yield* Stream.never.pipe(
          Stream.onStart(Deferred.succeed(started, undefined)),
          viewers.track(threadId),
          Stream.runDrain,
          Effect.forkChild,
        );
        yield* Deferred.await(started);
        return fiber;
      });

      assert.deepStrictEqual(yield* viewed, []);
      const first = yield* subscribe("thread-a");
      const second = yield* subscribe("thread-a");
      const other = yield* subscribe("thread-b");
      assert.deepStrictEqual(yield* viewed, ["thread-a", "thread-b"]);

      // One of two clients leaving leaves the thread shown.
      yield* Fiber.interrupt(first);
      yield* TestClock.adjust("10 minutes");
      assert.deepStrictEqual(yield* viewed, ["thread-a", "thread-b"]);

      // The last one leaving keeps it shown for a couple of minutes.
      yield* Fiber.interrupt(second);
      yield* TestClock.adjust("1 minute");
      assert.deepStrictEqual(yield* viewed, ["thread-a", "thread-b"]);
      yield* TestClock.adjust("1 minute");
      assert.deepStrictEqual(yield* viewed, ["thread-b"]);
      yield* Fiber.interrupt(other);
    }),
  );
});
