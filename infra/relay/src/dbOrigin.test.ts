import { describe, expect, it } from "vite-plus/test";
import * as Redacted from "effect/Redacted";

import { postgresOriginFromUrl } from "./dbOrigin.ts";

const url = "postgresql://relayuser:secret%2Fpass@db.example.com:5432/t3code_production";

describe("postgresOriginFromUrl", () => {
  it("keeps a public origin when no Access credentials are set", () => {
    const origin = postgresOriginFromUrl(url);

    expect(origin.scheme).toBe("postgres");
    expect(origin.host).toBe("db.example.com");
    if (!("port" in origin)) {
      throw new Error("public origin should keep the URL port");
    }
    expect(origin.port).toBe(5432);
    expect(origin.database).toBe("t3code_production");
    expect(origin.user).toBe("relayuser");
    expect(Redacted.value(origin.password)).toBe("secret/pass");
    expect("accessClientId" in origin).toBe(false);
  });

  it("builds an Access origin without a port", () => {
    const origin = postgresOriginFromUrl(url, {
      clientId: "client.access",
      clientSecret: "secret-value",
      host: "pg-db.example.com",
    });

    expect(origin.scheme).toBe("postgresql");
    expect(origin.host).toBe("pg-db.example.com");
    expect("port" in origin).toBe(false);
    if (!("accessClientId" in origin)) {
      throw new Error("expected an Access origin");
    }
    expect(Redacted.value(origin.accessClientId)).toBe("client.access");
    expect(Redacted.value(origin.accessClientSecret)).toBe("secret-value");
  });

  it("rejects a mesh address as the Access host", () => {
    expect(() =>
      postgresOriginFromUrl("postgresql://relayuser:secret@192.0.2.10:5432/t3code_production", {
        clientId: "client.access",
        clientSecret: "secret-value",
      }),
    ).toThrow(/Access hostname/);
  });

  it("requires both Access credentials", () => {
    expect(() =>
      postgresOriginFromUrl(url, { clientId: "client.access", clientSecret: "  " }),
    ).toThrow(/must both be set/);
  });
});
