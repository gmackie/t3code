import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { RunSpec } from "@t3tools/engine/contracts";
import type { ServerAuthPolicy } from "@t3tools/contracts";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

import { EnvironmentAuthPolicy } from "../auth/EnvironmentAuthPolicy.ts";
import * as EngineGateway from "./EngineGateway.ts";

const decodeSpec = Schema.decodeSync(RunSpec);
const spec = decodeSpec({
  apiVersion: "t3.engine/v1",
  moduleId: "cad",
  moduleVersion: "1.0.0",
  workflowId: "cad.release",
  resourceRefs: [{ namespace: "cad", type: "board", id: "main" }],
  inputArtifactIds: [],
  idempotencyKey: "gateway-release",
});

const gatewayLayer = (input: {
  readonly env: Record<string, string>;
  readonly policy: ServerAuthPolicy;
}) =>
  EngineGateway.layer.pipe(
    Layer.provide(
      Layer.succeed(EnvironmentAuthPolicy, {
        getDescriptor: () =>
          Effect.succeed({
            policy: input.policy,
            bootstrapMethods: [],
            sessionMethods: [],
            sessionCookieName: "engine-gateway-test",
          }),
      }),
    ),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: input.env }))),
    Layer.provideMerge(NodeSqliteClient.layer({ filename: ":memory:" })),
  );

const engineTables = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly name: string }>`
    SELECT name FROM sqlite_schema WHERE type = 'table' AND name LIKE 'engine_%'
  `;
  return rows.map((row) => row.name);
});

it.effect("refuses engine calls unless the install is declared single-owner", () =>
  Effect.gen(function* () {
    const gateway = yield* EngineGateway.EngineGateway;
    const error = yield* gateway
      .runs((runs, caller) => runs.create(caller, spec))
      .pipe(Effect.flip);
    assert.deepStrictEqual(
      { tag: error._tag, reason: "publicReasonCode" in error ? error.publicReasonCode : null },
      { tag: "EngineAuthorizationDenied", reason: "engine.disabled" },
    );
    // A disabled engine never builds its storage.
    assert.deepStrictEqual(yield* engineTables, []);
  }).pipe(Effect.provide(gatewayLayer({ env: {}, policy: "loopback-browser" }))),
);

it.effect("refuses engine calls on a server running without auth", () =>
  Effect.gen(function* () {
    const gateway = yield* EngineGateway.EngineGateway;
    const error = yield* gateway
      .runs((runs, caller) => runs.create(caller, spec))
      .pipe(Effect.flip);
    assert.strictEqual(error._tag, "EngineAuthorizationDenied");
  }).pipe(
    Effect.provide(
      gatewayLayer({ env: { T3CODE_ENGINE_SINGLE_OWNER: "true" }, policy: "unsafe-no-auth" }),
    ),
  ),
);

it.effect("serves the local owner once enabled", () =>
  Effect.gen(function* () {
    const gateway = yield* EngineGateway.EngineGateway;
    const run = yield* gateway.runs((runs, caller) => runs.create(caller, spec));
    assert.strictEqual(run.status, "queued");
    assert.deepStrictEqual(run.createdBy, EngineGateway.LOCAL_OWNER);
    const read = yield* gateway.runs((runs, caller) => runs.get(caller, run.runId));
    assert.deepStrictEqual(read, run);
  }).pipe(
    Effect.provide(
      gatewayLayer({ env: { T3CODE_ENGINE_SINGLE_OWNER: "true" }, policy: "remote-reachable" }),
    ),
  ),
);
