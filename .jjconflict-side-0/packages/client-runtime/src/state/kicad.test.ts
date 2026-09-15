import * as Layer from "effect/Layer";
import { RemoteEnvironmentAuthorization } from "../authorization/service.ts";
import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { PrimaryConnectionTarget, type PreparedConnection } from "../connection/model.ts";
import { remoteHttpClientLayer } from "../rpc/http.ts";
import { fetchKiCadJson } from "./kicad.ts";

const target = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("cad-environment"),
  label: "CAD environment",
  httpBaseUrl: "https://cad.example.test",
  wsBaseUrl: "wss://cad.example.test",
});
const prepared: PreparedConnection = {
  environmentId: target.environmentId,
  label: target.label,
  httpBaseUrl: target.httpBaseUrl,
  socketUrl: "wss://cad.example.test/ws",
  httpAuthorization: null,
  target,
};
const schema = Schema.Struct({ token: Schema.String, expiresAt: Schema.Number });

describe("CAD environment HTTP", () => {
  for (const bearer of [false, true]) {
    it.effect(`mints a workspace viewer session with ${bearer ? "bearer" : "cookie"} auth`, () =>
      Effect.gen(function* () {
        const calls: Array<readonly [RequestInfo | URL, RequestInit]> = [];
        const fetchFn = ((request, init) => {
          calls.push([request, init ?? {}]);
          return Promise.resolve(Response.json({ token: "viewer-session", expiresAt: 10000 }));
        }) satisfies typeof fetch;
        const result = yield* fetchKiCadJson({
          prepared: {
            ...prepared,
            httpAuthorization: bearer ? { _tag: "Bearer", token: "credential" } : null,
          },
          cwd: "/projects/board with spaces",
          path: "viewer-session",
          method: "POST",
          schema,
          signer: Option.none(),
        }).pipe(Effect.provide(remoteHttpClientLayer(fetchFn)));
        expect(result.token).toBe("viewer-session");
        const [request, init] = calls[0]!;
        const url = new URL(String(request));
        expect(url.origin).toBe("https://cad.example.test");
        expect(url.pathname).toBe("/api/kicad/viewer-session");
        expect(url.searchParams.get("cwd")).toBe("/projects/board with spaces");
        expect(init.method).toBe("POST");
        if (bearer)
          expect(new Headers(init.headers).get("authorization")).toBe("Bearer credential");
        else expect(init.credentials).toBe("include");
      }),
    );
  }
  it.effect("binds a relay proof to the CAD session request", () =>
    Effect.gen(function* () {
      const calls: Array<readonly [RequestInfo | URL, RequestInit]> = [];
      const proofs: Array<{ method: string; url: string; accessToken?: string }> = [];
      const fetchFn = ((request, init) => {
        calls.push([request, init ?? {}]);
        return Promise.resolve(Response.json({ token: "viewer-session", expiresAt: 10000 }));
      }) satisfies typeof fetch;
      yield* fetchKiCadJson({
        prepared: {
          ...prepared,
          httpAuthorization: {
            _tag: "Dpop",
            accessToken: "relay-credential",
            expiresAtEpochMs: 9999999999999,
          },
        },
        cwd: "/relay/board",
        path: "viewer-session",
        method: "POST",
        schema,
        signer: Option.some({
          thumbprint: Effect.succeed("thumbprint"),
          createProof: (input) => {
            proofs.push(input);
            return Effect.succeed("signed-proof");
          },
        }),
      }).pipe(
        Effect.provide(
          Layer.merge(
            remoteHttpClientLayer(fetchFn),
            Layer.mock(RemoteEnvironmentAuthorization)({
              authorizeDpopHttp: () =>
                Effect.succeed({
                  environmentId: prepared.environmentId,
                  label: prepared.label,
                  httpBaseUrl: prepared.httpBaseUrl,
                  httpAuthorization: {
                    _tag: "Dpop",
                    accessToken: "relay-credential",
                    expiresAtEpochMs: 9999999999999,
                  },
                }),
            }),
          ),
        ),
      );
      const [request, init] = calls[0]!;
      expect(proofs).toEqual([
        { method: "POST", url: String(request), accessToken: "relay-credential" },
      ]);
      expect(new Headers(init.headers).get("authorization")).toBe("DPoP relay-credential");
      expect(new Headers(init.headers).get("dpop")).toBe("signed-proof");
    }),
  );
  it.effect("explains when the connected server does not support CAD", () =>
    Effect.gen(function* () {
      const fetchFn = (() =>
        Promise.resolve(new Response("Not Found", { status: 404 }))) satisfies typeof fetch;
      const result = yield* fetchKiCadJson({
        prepared,
        cwd: "/project",
        path: "viewer-session",
        method: "POST",
        schema,
        signer: Option.none(),
      }).pipe(Effect.provide(remoteHttpClientLayer(fetchFn)), Effect.result);
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") expect(String(result.failure)).toContain("CAD");
    }),
  );
});
