import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { PrincipalId, RunSpec, TenantId, type PrincipalRef } from "@t3tools/engine/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as EngineJournal from "./EngineJournal.ts";
import * as EngineRuns from "./EngineRuns.ts";
import * as EngineWriteBudget from "./EngineWriteBudget.ts";

const decodeTenant = Schema.decodeSync(TenantId);
const decodePrincipal = Schema.decodeSync(PrincipalId);
const decodeSpec = Schema.decodeSync(RunSpec);

const principal = (tenant: string, id: string): PrincipalRef => ({
  tenantId: decodeTenant(tenant),
  principalId: decodePrincipal(id),
  kind: "human",
});
const owner = principal("local", "owner");
const stranger = principal("elsewhere", "someone");

const spec = (idempotencyKey: string) =>
  decodeSpec({
    apiVersion: "t3.engine/v1",
    moduleId: "cad",
    moduleVersion: "1.0.0",
    workflowId: "cad.release",
    resourceRefs: [{ namespace: "cad", type: "board", id: "main" }],
    inputArtifactIds: [],
    idempotencyKey,
  });

const TestLayer = EngineRuns.layer.pipe(
  Layer.provideMerge(EngineJournal.layer),
  Layer.provide(EngineWriteBudget.layer),
  Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
);

it.layer(TestLayer)("EngineRuns", (it) => {
  it.effect("creates a queued run owned by the caller's tenant", () =>
    Effect.gen(function* () {
      const runs = yield* EngineRuns.EngineRuns;
      const run = yield* runs.create(owner, spec("create-basic"));
      assert.strictEqual(run.status, "queued");
      assert.strictEqual(run.tenantId, owner.tenantId);
      assert.deepStrictEqual(run.createdBy, owner);
    }),
  );

  it.effect("returns the same run when a create is retried", () =>
    Effect.gen(function* () {
      const runs = yield* EngineRuns.EngineRuns;
      const journal = yield* EngineJournal.EngineJournal;
      const first = yield* runs.create(owner, spec("create-retry"));
      const second = yield* runs.create(owner, spec("create-retry"));
      assert.strictEqual(second.runId, first.runId);
      const events = yield* journal.read({
        tenantId: owner.tenantId,
        streamId: `run:${first.runId}`,
        afterVersion: 0,
        limit: 10,
      });
      assert.deepStrictEqual(
        events.map((event) => event.type),
        ["run.created", "run.status-changed"],
      );
    }),
  );

  it.effect("hides runs from other tenants", () =>
    Effect.gen(function* () {
      const runs = yield* EngineRuns.EngineRuns;
      const mine = yield* runs.create(owner, spec("tenant-key"));
      const error = yield* runs.get(stranger, mine.runId).pipe(Effect.flip);
      assert.strictEqual(error._tag, "EngineNotFound");
      const theirs = yield* runs.create(stranger, spec("tenant-key"));
      assert.notStrictEqual(theirs.runId, mine.runId);
    }),
  );

  it.effect("cancels a queued run and treats a retried cancel as done", () =>
    Effect.gen(function* () {
      const runs = yield* EngineRuns.EngineRuns;
      const run = yield* runs.create(owner, spec("cancel-me"));
      const cancelled = yield* runs.cancel({
        caller: owner,
        runId: run.runId,
        idempotencyKey: "c-1",
      });
      assert.strictEqual(cancelled.status, "cancelled");
      assert.isDefined(cancelled.finishedAt);
      const retried = yield* runs.cancel({
        caller: owner,
        runId: run.runId,
        idempotencyKey: "c-1",
      });
      assert.deepStrictEqual(retried, cancelled);
      const again = yield* runs
        .cancel({ caller: owner, runId: run.runId, idempotencyKey: "c-2" })
        .pipe(Effect.flip);
      assert.strictEqual(again._tag, "RunCommandRejected");
    }),
  );

  it.effect("refuses a transition outside the table and records nothing", () =>
    Effect.gen(function* () {
      const runs = yield* EngineRuns.EngineRuns;
      const run = yield* runs.create(owner, spec("bad-move"));
      const error = yield* runs
        .transition({ caller: owner, runId: run.runId, to: "completed", idempotencyKey: "t-1" })
        .pipe(Effect.flip);
      assert.strictEqual(error._tag, "RunCommandRejected");
      assert.deepStrictEqual(yield* runs.get(owner, run.runId), run);
    }),
  );

  it.effect("records an unverified external outcome and its later resolution", () =>
    Effect.gen(function* () {
      const runs = yield* EngineRuns.EngineRuns;
      const run = yield* runs.create(owner, spec("unknown-outcome"));
      for (const [to, key] of [
        ["leased", "u-1"],
        ["running", "u-2"],
        ["outcome-unknown", "u-3"],
      ] as const) {
        yield* runs.transition({ caller: owner, runId: run.runId, to, idempotencyKey: key });
      }
      const resolved = yield* runs.transition({
        caller: owner,
        runId: run.runId,
        to: "completed",
        idempotencyKey: "u-4",
      });
      assert.strictEqual(resolved.status, "completed");
      assert.strictEqual(resolved.revision, 6);
    }),
  );
});
