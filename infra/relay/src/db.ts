import type { PgClient } from "@effect/sql-pg/PgClient";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Drizzle from "@alchemy.run/drizzle";
import * as Planetscale from "@alchemy.run/planetscale";
import * as Alchemy from "alchemy";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import type { EffectPgDatabase } from "drizzle-orm/effect-postgres";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import { relayDatabaseMode } from "./dbConfig.ts";
import { postgresOriginFromUrl } from "./dbOrigin.ts";

export class RelayDb extends Context.Service<
  RelayDb,
  EffectPgDatabase & {
    readonly $client: PgClient;
  }
>()("t3code-relay/db/RelayDb") {}

export class RelayTransactions extends Context.Service<
  RelayTransactions,
  {
    readonly withTransaction: RelayDb["Service"]["$client"]["withTransaction"];
  }
>()("t3code-relay/db/RelayTransactions") {
  static readonly layer = Layer.effect(
    RelayTransactions,
    Effect.gen(function* () {
      const db = yield* RelayDb;
      return RelayTransactions.of({
        withTransaction: db.$client.withTransaction,
      });
    }),
  );
}

export const PlanetscaleDatabase = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;
  const schema = yield* Drizzle.Schema("RelaySchema", {
    schema: "./src/persistence/schema.ts",
    out: "./migrations/postgres",
    dialect: "postgres",
  });

  const mode = relayDatabaseMode(stage);
  const database =
    mode === "shared-database"
      ? yield* Planetscale.PostgresDatabase("RelayPostgresDatabase", {
          name: "t3coderelay",
          region: { slug: "us-west" },
          clusterSize: "PS_160",
          migrations: { dir: schema.out, table: "relay_migrations" },
          replicas: 2,
        }).pipe(RemovalPolicy.retain())
      : yield* Planetscale.PostgresDatabase.ref("RelayPostgresDatabase", {
          stage: "prod",
        });
  const branch =
    mode === "stage-branch"
      ? yield* Planetscale.PostgresBranch("RelayPostgresBranch", {
          database,
          migrations: { dir: schema.out, table: "relay_migrations" },
        })
      : undefined;

  const runtimeRole = yield* Planetscale.PostgresRole("RelayPostgresRuntimeRole", {
    database,
    ...(branch ? { branch } : {}),
    inheritedRoles: ["pg_read_all_data", "pg_write_all_data"],
  });

  return { branch, database, runtimeRole };
});

export const RelayHyperdrive = Effect.gen(function* () {
  const externalUrl = Option.getOrUndefined(
    yield* Config.option(Config.Redacted("RELAY_DATABASE_URL")),
  );
  const url = externalUrl ? Redacted.value(externalUrl).trim() : "";
  if (url.length > 0) {
    const accessId = Option.getOrUndefined(
      yield* Config.option(Config.String("RELAY_DATABASE_ACCESS_CLIENT_ID")),
    );
    const accessSecret = Option.getOrUndefined(
      yield* Config.option(Config.Redacted("RELAY_DATABASE_ACCESS_CLIENT_SECRET")),
    );
    const accessHost = Option.getOrUndefined(
      yield* Config.option(Config.String("RELAY_DATABASE_ACCESS_HOST")),
    );
    const clientId = accessId?.trim() ?? "";
    const clientSecret = accessSecret ? Redacted.value(accessSecret).trim() : "";
    const host = accessHost?.trim() ?? "";
    return yield* Cloudflare.Hyperdrive.Connection("RelayHyperdrive", {
      origin: postgresOriginFromUrl(
        url,
        clientId.length > 0 || clientSecret.length > 0
          ? {
              clientId,
              clientSecret,
              ...(host.length > 0 ? { host } : {}),
            }
          : undefined,
      ),
      caching: { disabled: true },
      originConnectionLimit: 20,
    });
  }
  const { runtimeRole } = yield* PlanetscaleDatabase;
  return yield* Cloudflare.Hyperdrive.Connection("RelayHyperdrive", {
    origin: runtimeRole.origin,
    caching: {
      disabled: true,
    },
    originConnectionLimit: 40,
  });
});
