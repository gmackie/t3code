import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";

import * as EngineWriteBudget from "./EngineWriteBudget.ts";

// A write that holds the writer for `ms` of (test) time.
const write = (ms: number) => TestClock.adjust(`${ms} millis`);

it.effect("holds further writes until the next window once the budget is spent", () =>
  Effect.gen(function* () {
    const budget = yield* EngineWriteBudget.make({ windowMs: 1_000, budgetMs: 50 });
    yield* budget.run(write(60));
    const next = yield* budget.run(Effect.succeed("ran")).pipe(Effect.forkChild);
    yield* TestClock.adjust("900 millis");
    assert.isUndefined(next.pollUnsafe());
    yield* TestClock.adjust("100 millis");
    assert.strictEqual(yield* Fiber.join(next), "ran");
  }),
);

it.effect("lets writes through while the window has budget left", () =>
  Effect.gen(function* () {
    const budget = yield* EngineWriteBudget.make({ windowMs: 1_000, budgetMs: 50 });
    yield* budget.run(write(20));
    yield* budget.run(write(20));
    const third = yield* budget.run(Effect.succeed("ran")).pipe(Effect.forkChild);
    yield* Effect.yieldNow;
    assert.isDefined(third.pollUnsafe());
  }),
);
