import * as Redacted from "effect/Redacted";

import type { AccessOrigin, PublicOrigin } from "@alchemy.run/cloudflare/Hyperdrive";

export type RelayDatabaseAccess = {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly host?: string;
};

const ipv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/u;

export function postgresOriginFromUrl(
  value: string,
  access?: RelayDatabaseAccess,
): PublicOrigin | AccessOrigin {
  const url = new URL(value);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("RELAY_DATABASE_URL must be a postgres URL");
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//u, ""));
  if (!url.hostname || !url.username || !database || url.password.length === 0) {
    throw new Error("RELAY_DATABASE_URL is missing host, user, password, or database");
  }
  const user = decodeURIComponent(url.username);
  const password = Redacted.make(decodeURIComponent(url.password));
  const clientId = access?.clientId.trim() ?? "";
  const clientSecret = access?.clientSecret.trim() ?? "";
  if ((clientId.length === 0) !== (clientSecret.length === 0)) {
    throw new Error(
      "RELAY_DATABASE_ACCESS_CLIENT_ID and RELAY_DATABASE_ACCESS_CLIENT_SECRET must both be set",
    );
  }
  if (clientId.length === 0) {
    const port = url.port ? Number(url.port) : undefined;
    return {
      scheme: "postgres",
      host: url.hostname,
      ...(port === undefined ? {} : { port }),
      database,
      user,
      password,
    };
  }
  // Access origins have no port. Cloudflare reaches the database through the
  // Access hostname, so a mesh IP or bare IPv6 address cannot be the host.
  const host = access?.host?.trim() || url.hostname;
  if (ipv4.test(host) || host.includes(":")) {
    throw new Error("RELAY_DATABASE_ACCESS_HOST must be the Access hostname, not a mesh address");
  }
  return {
    scheme: "postgresql",
    host,
    database,
    user,
    password,
    accessClientId: Redacted.make(clientId),
    accessClientSecret: Redacted.make(clientSecret),
  };
}
