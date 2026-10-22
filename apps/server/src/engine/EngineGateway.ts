import {
  EngineAuthorizationDenied,
  EngineUnavailable,
  PrincipalId,
  TenantId,
  type PrincipalRef,
} from "@t3tools/engine/contracts";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as SqlClient from "effect/sql/SqlClient";
import type { EngineRpcError } from "@t3tools/contracts/engineRpc";

import { EnvironmentAuthPolicy } from "../auth/EnvironmentAuthPolicy.ts";
import * as EngineJournal from "./EngineJournal.ts";
import * as EngineRuns from "./EngineRuns.ts";
import * as EngineWriteBudget from "./EngineWriteBudget.ts";

/**
 * The transport-facing entry to the engine. Until verified principals exist
 * (plan PR05), the engine serves only installs whose operator has declared
 * them single-owner with T3CODE_ENGINE_SINGLE_OWNER=1, and never one running
 * without auth (reviews D7/D18). Every paired session then acts as the local
 * owner. The engine's tables and services are built on first use, so a
 * server with the engine off never creates them.
 */
export interface EngineGatewayShape {
  readonly runs: <A>(
    use: (
      runs: EngineRuns.EngineRunsShape,
      caller: PrincipalRef,
    ) => Effect.Effect<A, EngineRpcError | EngineRuns.EngineRunsError>,
  ) => Effect.Effect<A, EngineRpcError>;
}

export class EngineGateway extends Context.Service<EngineGateway, EngineGatewayShape>()(
  "t3/engine/EngineGateway",
) {}

export const LOCAL_OWNER: PrincipalRef = {
  tenantId: Schema.decodeSync(TenantId)("local"),
  principalId: Schema.decodeSync(PrincipalId)("owner"),
  kind: "human",
};

const singleOwnerConfig = Config.Boolean("T3CODE_ENGINE_SINGLE_OWNER").pipe(
  Config.withDefault(false),
);

const toRpcError = (error: EngineRpcError | EngineRuns.EngineRunsError): EngineRpcError => {
  switch (error._tag) {
    case "PersistenceSqlError":
      return new EngineUnavailable({ reason: "engine.storage" });
    case "EngineCommitTooLarge":
      return new EngineUnavailable({ reason: "engine.commit-too-large" });
    default:
      return error;
  }
};

const make = Effect.gen(function* () {
  const singleOwner = yield* singleOwnerConfig;
  const authPolicy = yield* EnvironmentAuthPolicy;
  const sql = yield* SqlClient.SqlClient;
  const scope = yield* Scope.Scope;
  const engineContext = yield* Layer.buildWithScope(
    EngineRuns.layer.pipe(
      Layer.provideMerge(EngineJournal.layer),
      Layer.provide(EngineWriteBudget.layer),
    ),
    scope,
  ).pipe(Effect.provideService(SqlClient.SqlClient, sql), Effect.cached);

  const allowed = Effect.gen(function* () {
    if (!singleOwner) {
      return yield* new EngineAuthorizationDenied({ publicReasonCode: "engine.disabled" });
    }
    const { policy } = yield* authPolicy.getDescriptor();
    if (policy === "unsafe-no-auth") {
      return yield* new EngineAuthorizationDenied({ publicReasonCode: "engine.requires-auth" });
    }
  });

  const runs: EngineGatewayShape["runs"] = (use) =>
    allowed.pipe(
      Effect.andThen(
        engineContext.pipe(
          Effect.mapError(() => new EngineUnavailable({ reason: "engine.storage" })),
        ),
      ),
      Effect.flatMap((context) => use(Context.get(context, EngineRuns.EngineRuns), LOCAL_OWNER)),
      Effect.mapError(toRpcError),
    );

  return EngineGateway.of({ runs });
});

export const layer = Layer.effect(EngineGateway, make);
