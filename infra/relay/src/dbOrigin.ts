import * as Redacted from "effect/Redacted";

import type { PublicOrigin } from "@alchemy.run/cloudflare/Hyperdrive";

export function postgresOriginFromUrl(value: string): PublicOrigin {
  const url = new URL(value);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("RELAY_DATABASE_URL must be a postgres URL");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//u, ""));
  if (!url.hostname || !url.username || !database || url.password.length === 0) {
    throw new Error("RELAY_DATABASE_URL is missing host, user, password, or database");
  }
  const port = url.port ? Number(url.port) : undefined;
  return {
    scheme: "postgres",
    host: url.hostname,
    ...(port === undefined ? {} : { port }),
    database,
    user: decodeURIComponent(url.username),
    password: Redacted.make(decodeURIComponent(url.password)),
  };
}
