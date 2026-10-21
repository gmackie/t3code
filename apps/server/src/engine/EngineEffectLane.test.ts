import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { TenantId } from "@t3tools/engine/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import {
  EngineEffectLane,
  type EngineEffectInput,
  layer as effectLaneLayer,
  processNextEngineEffect,
} from "./EngineEffectLane.ts";
import * as EngineJournal from "./EngineJournal.ts";
import * as EngineWriteBudget from "./EngineWriteBudget.ts";

const tenant = Schema.decodeSync(TenantId)("local");
const lease = { workerId: "engine:test", leaseDuration: "30 seconds" } as const;

const TestLayer = Layer.mergeAll(EngineJournal.layer, effectLaneLayer).pipe(
  Layer.provide(EngineWriteBudget.layer),
  Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
);

const effect = (
  effectId: string,
  overrides: Partial<EngineEffectInput> = {},
): EngineEffectInput => ({
  effectId,
  laneKey: "run-1",
  type: "cad.release.submit",
  retryClass: "replay-safe",
  payload: { effectId },
  ...overrides,
});

const enqueue = (streamId: string, effects: ReadonlyArray<EngineEffectInput>) =>
  Effect.gen(function* () {
    const journal = yield* EngineJournal.EngineJournal;
    yield* journal.commit({
      tenantId: tenant,
      streamId,
      expectedVersion: 0,
      idempotencyKey: `enqueue-${streamId}`,
      commandType: "run.create",
      events: [],
      effects,
    });
  });

const claimSome = Effect.gen(function* () {
  const lane = yield* EngineEffectLane;
  const claimed = yield* lane.claimNext(lease);
  assert.isTrue(Option.isSome(claimed));
  return Option.getOrThrow(claimed);
});

it.effect("requeues an expired replay-safe effect under a new claim epoch", () =>
  Effect.gen(function* () {
    yield* enqueue("s-replay", [effect("replay")]);
    const first = yield* claimSome;
    yield* TestClock.adjust("31 seconds");
    const second = yield* claimSome;
    assert.strictEqual(second.effectId, "replay");
    assert.strictEqual(second.attempt, 2);
    assert.isTrue(second.claimEpoch > first.claimEpoch);
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("never re-runs an expired process-bound effect; its outcome is unknown", () =>
  Effect.gen(function* () {
    const lane = yield* EngineEffectLane;
    yield* enqueue("s-bound", [effect("bound", { retryClass: "process-bound" })]);
    yield* claimSome;
    yield* TestClock.adjust("31 seconds");
    assert.isTrue(Option.isNone(yield* lane.claimNext(lease)));
    assert.deepStrictEqual(yield* lane.status("bound"), Option.some("outcome-unknown"));
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("rejects a settle from a stale claim even with the same worker id", () =>
  Effect.gen(function* () {
    const lane = yield* EngineEffectLane;
    yield* enqueue("s-stale", [effect("stale")]);
    const stale = yield* claimSome;
    yield* TestClock.adjust("31 seconds");
    const current = yield* claimSome;
    assert.isFalse(yield* lane.succeed(stale));
    assert.deepStrictEqual(yield* lane.status("stale"), Option.some("running"));
    assert.isTrue(yield* lane.succeed(current));
    assert.deepStrictEqual(yield* lane.status("stale"), Option.some("succeeded"));
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("does not reclaim an effect whose lease was renewed", () =>
  Effect.gen(function* () {
    const lane = yield* EngineEffectLane;
    yield* enqueue("s-renew", [effect("renewed")]);
    const claim = yield* claimSome;
    yield* TestClock.adjust("20 seconds");
    assert.isTrue(yield* lane.renew(claim, "30 seconds"));
    yield* TestClock.adjust("20 seconds");
    assert.isTrue(Option.isNone(yield* lane.claimNext(lease)));
    assert.deepStrictEqual(yield* lane.status("renewed"), Option.some("running"));
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("runs one effect per lane at a time", () =>
  Effect.gen(function* () {
    const lane = yield* EngineEffectLane;
    yield* enqueue("s-lanes", [
      effect("a-1", { laneKey: "lane-a" }),
      effect("a-2", { laneKey: "lane-a" }),
      effect("b-1", { laneKey: "lane-b" }),
    ]);
    const first = yield* claimSome;
    const second = yield* claimSome;
    assert.deepStrictEqual([first.effectId, second.effectId], ["a-1", "b-1"]);
    assert.isTrue(Option.isNone(yield* lane.claimNext(lease)));
    yield* lane.succeed(first);
    assert.strictEqual((yield* claimSome).effectId, "a-2");
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("enqueues nothing when the journal commit is rejected", () =>
  Effect.gen(function* () {
    const journal = yield* EngineJournal.EngineJournal;
    yield* enqueue("s-conflict", []);
    yield* journal
      .commit({
        tenantId: tenant,
        streamId: "s-conflict",
        expectedVersion: 5,
        idempotencyKey: "late",
        commandType: "run.cancel",
        events: [],
        effects: [effect("orphan")],
      })
      .pipe(Effect.flip);
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ readonly n: number }>`
      SELECT COUNT(*) AS n FROM engine_effects WHERE effect_id = 'orphan'
    `;
    assert.strictEqual(rows[0]?.n, 0);
  }).pipe(Effect.provide(TestLayer)),
);

const workerOptions = {
  ...lease,
  maxAttempts: 3,
  retryDelay: () => "5 seconds" as const,
} as const;

it.effect("keeps a slow handler's lease alive until it finishes", () =>
  Effect.gen(function* () {
    const lane = yield* EngineEffectLane;
    yield* enqueue("s-slow", [effect("slow", { retryClass: "process-bound" })]);
    const worker = yield* processNextEngineEffect(
      {
        "cad.release.submit": {
          retryClass: "process-bound",
          run: () => Effect.sleep("100 seconds"),
        },
      },
      workerOptions,
    ).pipe(Effect.forkChild);
    yield* TestClock.adjust("100 seconds");
    assert.isTrue(yield* Fiber.join(worker));
    assert.deepStrictEqual(yield* lane.status("slow"), Option.some("succeeded"));
  }).pipe(Effect.provide(TestLayer)),
);

it.effect("retries a failed replay-safe handler, then succeeds", () =>
  Effect.gen(function* () {
    const lane = yield* EngineEffectLane;
    yield* enqueue("s-flaky", [effect("flaky")]);
    let calls = 0;
    const registry = {
      "cad.release.submit": {
        retryClass: "replay-safe" as const,
        run: () => {
          calls += 1;
          return calls === 1 ? Effect.fail("transient") : Effect.void;
        },
      },
    };
    yield* processNextEngineEffect(registry, workerOptions);
    assert.deepStrictEqual(yield* lane.status("flaky"), Option.some("pending"));
    assert.isFalse(yield* processNextEngineEffect(registry, workerOptions));
    yield* TestClock.adjust("5 seconds");
    assert.isTrue(yield* processNextEngineEffect(registry, workerOptions));
    assert.deepStrictEqual(yield* lane.status("flaky"), Option.some("succeeded"));
    assert.strictEqual(calls, 2);
  }).pipe(Effect.provide(TestLayer)),
);
