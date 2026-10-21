import {
  EngineEvent,
  EngineIdempotencyConflict,
  EngineRevisionConflict,
  PrincipalRef,
  type EngineEventId,
  type EngineName,
  type RunId,
  type TenantId,
} from "@t3tools/engine/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { type PersistenceSqlError, toPersistenceSqlError } from "../persistence/Errors.ts";
import { runEngineMigrations } from "./EngineMigrations.ts";

export interface EngineJournalEventInput {
  readonly eventId: EngineEventId;
  readonly type: EngineName;
  readonly runId?: RunId;
  readonly actor: PrincipalRef;
  readonly occurredAt: string;
  readonly payload: unknown;
}

export interface EngineJournalCommitInput {
  readonly tenantId: TenantId;
  readonly streamId: string;
  /** The stream version the caller decided against; 0 for a new stream. */
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
  readonly commandType: string;
  readonly events: ReadonlyArray<EngineJournalEventInput>;
}

export interface EngineJournalCommitResult {
  readonly streamVersion: number;
  /** True when the idempotency key was already committed and nothing was written. */
  readonly replayed: boolean;
}

export type EngineJournalCommitError =
  | EngineRevisionConflict
  | EngineIdempotencyConflict
  | PersistenceSqlError;

export interface EngineJournalShape {
  /**
   * Appends events to one stream if it is still at `expectedVersion`, and
   * records the idempotency receipt, in one transaction. Repeating a committed
   * key returns its original result without writing again.
   */
  readonly commit: (
    input: EngineJournalCommitInput,
  ) => Effect.Effect<EngineJournalCommitResult, EngineJournalCommitError>;
  readonly read: (input: {
    readonly tenantId: TenantId;
    readonly streamId: string;
    readonly afterVersion: number;
    readonly limit: number;
  }) => Effect.Effect<ReadonlyArray<EngineEvent>, PersistenceSqlError>;
}

export class EngineJournal extends Context.Service<EngineJournal, EngineJournalShape>()(
  "t3/engine/EngineJournal",
) {}

const ActorJson = Schema.fromJsonString(PrincipalRef);
const PayloadJson = Schema.fromJsonString(Schema.Unknown);
const encodeActor = Schema.encodeEffect(ActorJson);
const encodePayload = Schema.encodeEffect(PayloadJson);

/** An `engine_events` row; the JSON columns decode into the contract's fields. */
const EventRow = Schema.Struct({
  eventId: EngineEvent.fields.eventId,
  tenantId: EngineEvent.fields.tenantId,
  streamId: EngineEvent.fields.streamId,
  streamVersion: EngineEvent.fields.streamVersion,
  type: EngineEvent.fields.type,
  runId: Schema.NullOr(Schema.String),
  actorJson: ActorJson,
  occurredAt: EngineEvent.fields.occurredAt,
  payloadJson: PayloadJson,
});
const decodeRow = Schema.decodeUnknownEffect(EventRow);
const decodeEvent = Schema.decodeUnknownEffect(EngineEvent);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* runEngineMigrations();

  const commitInTransaction = Effect.fn("EngineJournal.commit")(function* (
    input: EngineJournalCommitInput,
  ) {
    const receipts = yield* sql<{
      readonly commandType: string;
      readonly streamId: string;
      readonly resultVersion: number;
    }>`
      SELECT command_type AS "commandType", stream_id AS "streamId", result_version AS "resultVersion"
      FROM engine_command_receipts
      WHERE tenant_id = ${input.tenantId} AND idempotency_key = ${input.idempotencyKey}
    `;
    const receipt = receipts[0];
    if (receipt !== undefined) {
      if (receipt.commandType !== input.commandType || receipt.streamId !== input.streamId) {
        return yield* new EngineIdempotencyConflict({ idempotencyKey: input.idempotencyKey });
      }
      return { streamVersion: receipt.resultVersion, replayed: true };
    }

    const heads = yield* sql<{ readonly version: number | null }>`
      SELECT MAX(stream_version) AS version
      FROM engine_events
      WHERE tenant_id = ${input.tenantId} AND stream_id = ${input.streamId}
    `;
    const currentVersion = heads[0]?.version ?? 0;
    if (currentVersion !== input.expectedVersion) {
      return yield* new EngineRevisionConflict({
        streamId: input.streamId,
        expectedVersion: input.expectedVersion,
        actualVersion: currentVersion,
      });
    }

    let version = currentVersion;
    for (const event of input.events) {
      version += 1;
      const actorJson = yield* encodeActor(event.actor);
      const payloadJson = yield* encodePayload(event.payload ?? null);
      yield* sql`
        INSERT INTO engine_events (
          tenant_id, stream_id, stream_version, event_id, event_type,
          run_id, actor_json, occurred_at, payload_json
        )
        VALUES (
          ${input.tenantId}, ${input.streamId}, ${version}, ${event.eventId}, ${event.type},
          ${event.runId ?? null}, ${actorJson}, ${event.occurredAt}, ${payloadJson}
        )
      `;
    }
    const acceptedAt = DateTime.formatIso(yield* DateTime.now);
    yield* sql`
      INSERT INTO engine_command_receipts (
        tenant_id, idempotency_key, command_type, stream_id, result_version, accepted_at
      )
      VALUES (
        ${input.tenantId}, ${input.idempotencyKey}, ${input.commandType},
        ${input.streamId}, ${version}, ${acceptedAt}
      )
    `;
    return { streamVersion: version, replayed: false };
  });

  const commit: EngineJournalShape["commit"] = (input) =>
    sql.withTransaction(commitInTransaction(input)).pipe(
      Effect.catchTags({
        SqlError: (cause) => Effect.fail(toPersistenceSqlError("EngineJournal.commit")(cause)),
        SchemaError: (cause) =>
          Effect.fail(toPersistenceSqlError("EngineJournal.commit:encode")(cause)),
      }),
    );

  const read: EngineJournalShape["read"] = (input) =>
    sql`
      SELECT
        event_id AS "eventId",
        tenant_id AS "tenantId",
        stream_id AS "streamId",
        stream_version AS "streamVersion",
        event_type AS "type",
        run_id AS "runId",
        actor_json AS "actorJson",
        occurred_at AS "occurredAt",
        payload_json AS "payloadJson"
      FROM engine_events
      WHERE tenant_id = ${input.tenantId}
        AND stream_id = ${input.streamId}
        AND stream_version > ${input.afterVersion}
      ORDER BY stream_version ASC
      LIMIT ${input.limit}
    `.pipe(
      Effect.flatMap((rows) =>
        Effect.forEach(rows, (raw) =>
          decodeRow(raw).pipe(
            Effect.flatMap(({ runId, actorJson, payloadJson, ...row }) =>
              decodeEvent({
                ...row,
                ...(runId === null ? {} : { runId }),
                actor: actorJson,
                payload: payloadJson,
              }),
            ),
          ),
        ),
      ),
      Effect.mapError(toPersistenceSqlError("EngineJournal.read")),
    );

  return EngineJournal.of({ commit, read });
});

/** Runs the engine's own migrations on construction, after the main migrator. */
export const layer = Layer.effect(EngineJournal, make);
