import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";

/**
 * node:sqlite writes block the main thread coding turns share, so engine writers run one at a time
 * with at most `budgetMs` of write time per `windowMs`; once spent, the next write waits for the
 * next window. A write can overshoot by its own duration, which the journal's row cap keeps small
 * (see scripts/engine-contention-bench.ts).
 */
export interface EngineWriteBudgetShape {
  readonly run: <A, E, R>(write: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>;
}

export class EngineWriteBudget extends Context.Service<EngineWriteBudget, EngineWriteBudgetShape>()(
  "t3/engine/EngineWriteBudget",
) {}

export const DEFAULT_ENGINE_WRITE_BUDGET = { windowMs: 1_000, budgetMs: 50 } as const;

export const make = Effect.fn("EngineWriteBudget.make")(function* (options: {
  readonly windowMs: number;
  readonly budgetMs: number;
}) {
  const writer = yield* Semaphore.make(1);
  const window = yield* Ref.make({ startedAt: 0, usedMs: 0 });

  const waitForBudget = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const current = yield* Ref.get(window);
    if (now - current.startedAt >= options.windowMs) {
      yield* Ref.set(window, { startedAt: now, usedMs: 0 });
      return;
    }
    if (current.usedMs < options.budgetMs) return;
    yield* Effect.sleep(Duration.millis(current.startedAt + options.windowMs - now));
    yield* Ref.set(window, { startedAt: yield* Clock.currentTimeMillis, usedMs: 0 });
  });

  const run: EngineWriteBudgetShape["run"] = (write) =>
    writer.withPermits(1)(
      Effect.gen(function* () {
        yield* waitForBudget;
        const startedAt = yield* Clock.currentTimeMillis;
        return yield* write.pipe(
          Effect.ensuring(
            Clock.currentTimeMillis.pipe(
              Effect.flatMap((endedAt) =>
                Ref.update(window, (current) => ({
                  ...current,
                  usedMs: current.usedMs + (endedAt - startedAt),
                })),
              ),
            ),
          ),
        );
      }),
    );

  return EngineWriteBudget.of({ run });
});

export const layer = Layer.effect(EngineWriteBudget, make(DEFAULT_ENGINE_WRITE_BUDGET));
