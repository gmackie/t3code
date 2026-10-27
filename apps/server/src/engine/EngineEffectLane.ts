import type { TenantId } from "@t3tools/engine/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import type * as SqlError from "effect/sql/SqlError";

import { type PersistenceSqlError, toPersistenceSqlError } from "../persistence/Errors.ts";
import { runEngineMigrations } from "./EngineMigrations.ts";
import { EngineWriteBudget } from "./EngineWriteBudget.ts";

/**
 * Engine side effects, queued in the same transaction as their events (EngineJournal.commit), run
 * one at a time per `laneKey`. A claim bumps `claim_epoch` and renew/settle must present it, so an
 * expired worker cannot settle a re-claimed row, even under the same worker id. An expired lease
 * returns to pending if replay-safe, or becomes outcome-unknown (never re-run) if process-bound.
 */
export const EngineEffectRetryClass = Schema.Literals(["replay-safe", "process-bound"]);
export type EngineEffectRetryClass = typeof EngineEffectRetryClass.Type;

export const EngineEffectStatus = Schema.Literals([
  "pending",
  "running",
  "succeeded",
  "failed",
  "outcome-unknown",
]);
export type EngineEffectStatus = typeof EngineEffectStatus.Type;

export interface EngineEffectInput {
  /** Deterministic per command, so a retried command enqueues nothing new. */
  readonly effectId: string;
  readonly laneKey: string;
  readonly type: string;
  readonly retryClass: EngineEffectRetryClass;
  readonly payload: unknown;
}

export interface ClaimedEngineEffect {
  readonly effectId: string;
  readonly tenantId: TenantId;
  readonly laneKey: string;
  readonly type: string;
  readonly retryClass: EngineEffectRetryClass;
  readonly payload: unknown;
  readonly attempt: number;
  readonly claimEpoch: number;
}

const PayloadJson = Schema.fromJsonString(Schema.Unknown);
const encodePayload = Schema.encodeEffect(PayloadJson);
const ClaimedRow = Schema.Struct({
  effectId: Schema.String,
  tenantId: Schema.String,
  laneKey: Schema.String,
  type: Schema.String,
  retryClass: EngineEffectRetryClass,
  payload: PayloadJson,
  attempt: Schema.Int,
  claimEpoch: Schema.Int,
});
const decodeClaimedRow = Schema.decodeUnknownEffect(ClaimedRow);
const decodeStatus = Schema.decodeUnknownEffect(EngineEffectStatus);

const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));
const isoAfter = (duration: Duration.Input) =>
  DateTime.now.pipe(Effect.map((now) => DateTime.formatIso(DateTime.addDuration(now, duration))));

/** Inserts effects; callers run it inside the transaction that commits their events. */
export const insertEngineEffects = Effect.fn("insertEngineEffects")(function* (
  tenantId: TenantId,
  effects: ReadonlyArray<EngineEffectInput>,
) {
  const sql = yield* SqlClient.SqlClient;
  const now = yield* nowIso;
  for (const effect of effects) {
    const payloadJson = yield* encodePayload(effect.payload ?? null);
    yield* sql`
      INSERT INTO engine_effects (
        effect_id, tenant_id, lane_key, effect_type, retry_class, payload_json,
        status, available_at, created_at
      )
      VALUES (
        ${effect.effectId}, ${tenantId}, ${effect.laneKey}, ${effect.type},
        ${effect.retryClass}, ${payloadJson}, 'pending', ${now}, ${now}
      )
      ON CONFLICT (effect_id) DO NOTHING
    `;
  }
});

export interface EngineEffectLaneShape {
  /** Recovers expired leases by retry class, then claims the next runnable effect. */
  readonly claimNext: (input: {
    readonly workerId: string;
    readonly leaseDuration: Duration.Input;
  }) => Effect.Effect<Option.Option<ClaimedEngineEffect>, PersistenceSqlError>;
  /** Extends a live lease. False when the claim is stale. */
  readonly renew: (
    claim: ClaimedEngineEffect,
    leaseDuration: Duration.Input,
  ) => Effect.Effect<boolean, PersistenceSqlError>;
  /** Each settle returns false, and changes nothing, when the claim is stale. */
  readonly succeed: (claim: ClaimedEngineEffect) => Effect.Effect<boolean, PersistenceSqlError>;
  readonly retry: (
    claim: ClaimedEngineEffect,
    input: { readonly delay: Duration.Input; readonly error: string },
  ) => Effect.Effect<boolean, PersistenceSqlError>;
  readonly fail: (
    claim: ClaimedEngineEffect,
    error: string,
  ) => Effect.Effect<boolean, PersistenceSqlError>;
  readonly status: (
    effectId: string,
  ) => Effect.Effect<Option.Option<EngineEffectStatus>, PersistenceSqlError>;
}

export class EngineEffectLane extends Context.Service<EngineEffectLane, EngineEffectLaneShape>()(
  "t3/engine/EngineEffectLane",
) {}

const mapSqlError =
  (operation: string) =>
  <A, R>(effect: Effect.Effect<A, SqlError.SqlError | Schema.SchemaError, R>) =>
    effect.pipe(Effect.mapError(toPersistenceSqlError(operation)));

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const budget = yield* EngineWriteBudget;
  yield* runEngineMigrations();

  const recoverExpired = Effect.fn("EngineEffectLane.recoverExpired")(function* (now: string) {
    yield* sql`
      UPDATE engine_effects
      SET status = 'pending', lease_owner = NULL, lease_expires_at = NULL,
          last_error = 'lease expired; requeued'
      WHERE status = 'running' AND retry_class = 'replay-safe' AND lease_expires_at < ${now}
    `;
    yield* sql`
      UPDATE engine_effects
      SET status = 'outcome-unknown', lease_owner = NULL, lease_expires_at = NULL,
          last_error = 'lease expired; outcome unknown', completed_at = ${now}
      WHERE status = 'running' AND retry_class = 'process-bound' AND lease_expires_at < ${now}
    `;
  });

  const claimNext: EngineEffectLaneShape["claimNext"] = ({ workerId, leaseDuration }) =>
    budget
      .run(
        sql.withTransaction(
          Effect.gen(function* () {
            const now = yield* nowIso;
            const leaseExpiresAt = yield* isoAfter(leaseDuration);
            yield* recoverExpired(now);
            const rows = yield* sql`
            UPDATE engine_effects
            SET status = 'running',
                attempt_count = attempt_count + 1,
                claim_epoch = claim_epoch + 1,
                lease_owner = ${workerId},
                lease_expires_at = ${leaseExpiresAt}
            WHERE effect_id = (
              SELECT candidate.effect_id
              FROM engine_effects AS candidate
              WHERE candidate.status = 'pending'
                AND candidate.available_at <= ${now}
                AND NOT EXISTS (
                  SELECT 1 FROM engine_effects AS active
                  WHERE active.lane_key = candidate.lane_key AND active.status = 'running'
                )
              ORDER BY candidate.available_at, candidate.created_at, candidate.effect_id
              LIMIT 1
            )
            RETURNING
              effect_id AS "effectId",
              tenant_id AS "tenantId",
              lane_key AS "laneKey",
              effect_type AS "type",
              retry_class AS "retryClass",
              payload_json AS "payload",
              attempt_count AS "attempt",
              claim_epoch AS "claimEpoch"
          `;
            const row = rows[0];
            if (row === undefined) return Option.none<ClaimedEngineEffect>();
            const claimed = yield* decodeClaimedRow(row);
            return Option.some({ ...claimed, tenantId: claimed.tenantId as TenantId });
          }),
        ),
      )
      .pipe(mapSqlError("EngineEffectLane.claimNext"));

  const settled = <R>(
    operation: string,
    statement: Effect.Effect<ReadonlyArray<unknown>, SqlError.SqlError, R>,
  ) =>
    budget.run(statement).pipe(
      Effect.map((rows) => rows.length === 1),
      mapSqlError(operation),
    );

  const renew: EngineEffectLaneShape["renew"] = (claim, leaseDuration) =>
    isoAfter(leaseDuration).pipe(
      Effect.flatMap((leaseExpiresAt) =>
        settled(
          "EngineEffectLane.renew",
          sql`
            UPDATE engine_effects SET lease_expires_at = ${leaseExpiresAt}
            WHERE effect_id = ${claim.effectId} AND status = 'running'
              AND claim_epoch = ${claim.claimEpoch}
            RETURNING effect_id
          `,
        ),
      ),
    );

  const succeed: EngineEffectLaneShape["succeed"] = (claim) =>
    nowIso.pipe(
      Effect.flatMap((now) =>
        settled(
          "EngineEffectLane.succeed",
          sql`
            UPDATE engine_effects
            SET status = 'succeeded', completed_at = ${now}, lease_owner = NULL,
                lease_expires_at = NULL, last_error = NULL
            WHERE effect_id = ${claim.effectId} AND status = 'running'
              AND claim_epoch = ${claim.claimEpoch}
            RETURNING effect_id
          `,
        ),
      ),
    );

  const retry: EngineEffectLaneShape["retry"] = (claim, { delay, error }) =>
    isoAfter(delay).pipe(
      Effect.flatMap((availableAt) =>
        settled(
          "EngineEffectLane.retry",
          sql`
            UPDATE engine_effects
            SET status = 'pending', available_at = ${availableAt}, lease_owner = NULL,
                lease_expires_at = NULL, last_error = ${error}
            WHERE effect_id = ${claim.effectId} AND status = 'running'
              AND claim_epoch = ${claim.claimEpoch}
            RETURNING effect_id
          `,
        ),
      ),
    );

  const fail: EngineEffectLaneShape["fail"] = (claim, error) =>
    nowIso.pipe(
      Effect.flatMap((now) =>
        settled(
          "EngineEffectLane.fail",
          sql`
            UPDATE engine_effects
            SET status = 'failed', completed_at = ${now}, lease_owner = NULL,
                lease_expires_at = NULL, last_error = ${error}
            WHERE effect_id = ${claim.effectId} AND status = 'running'
              AND claim_epoch = ${claim.claimEpoch}
            RETURNING effect_id
          `,
        ),
      ),
    );

  const status: EngineEffectLaneShape["status"] = (effectId) =>
    sql<{ readonly status: string }>`
      SELECT status FROM engine_effects WHERE effect_id = ${effectId}
    `.pipe(
      Effect.flatMap((rows) =>
        rows[0] === undefined
          ? Effect.succeedNone
          : decodeStatus(rows[0].status).pipe(Effect.asSome),
      ),
      mapSqlError("EngineEffectLane.status"),
    );

  return EngineEffectLane.of({ claimNext, renew, succeed, retry, fail, status });
});

export const layer = Layer.effect(EngineEffectLane, make);

export interface EngineEffectHandler<E, R> {
  readonly retryClass: EngineEffectRetryClass;
  readonly run: (effect: ClaimedEngineEffect) => Effect.Effect<void, E, R>;
}

export type EngineEffectRegistry<E, R> = Readonly<Record<string, EngineEffectHandler<E, R>>>;

/**
 * Claims and runs one effect with the handler registered for its type. The
 * lease is renewed every third of its duration while the handler runs, so a
 * slow effect is never mistaken for a lost one. Returns false when nothing
 * was claimable.
 */
export const processNextEngineEffect = Effect.fn("processNextEngineEffect")(function* <E, R>(
  registry: EngineEffectRegistry<E, R>,
  options: {
    readonly workerId: string;
    readonly leaseDuration: Duration.Input;
    readonly maxAttempts: number;
    readonly retryDelay: (attempt: number) => Duration.Input;
  },
) {
  const lane = yield* EngineEffectLane;
  const claimed = yield* lane.claimNext(options);
  if (Option.isNone(claimed)) return false;
  const claim = claimed.value;
  const handler = registry[claim.type];
  if (handler === undefined) {
    yield* lane.fail(claim, `no handler registered for ${claim.type}`);
    return true;
  }
  const renewEvery = Duration.divideUnsafe(Duration.fromInputUnsafe(options.leaseDuration), 3);
  const keepLeaseAlive = lane
    .renew(claim, options.leaseDuration)
    .pipe(Effect.repeat(Schedule.spaced(renewEvery)), Effect.delay(renewEvery));
  const outcome = yield* handler
    .run(claim)
    .pipe(Effect.raceFirst(keepLeaseAlive.pipe(Effect.andThen(Effect.never))), Effect.exit);
  if (outcome._tag === "Success") {
    yield* lane.succeed(claim);
  } else if (claim.retryClass === "replay-safe" && claim.attempt < options.maxAttempts) {
    yield* lane.retry(claim, {
      delay: options.retryDelay(claim.attempt),
      error: String(outcome.cause),
    });
  } else {
    yield* lane.fail(claim, String(outcome.cause));
  }
  return true;
});
