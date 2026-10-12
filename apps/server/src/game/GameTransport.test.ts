// @effect-diagnostics nodeBuiltinImport:off - Native HTTP server fixture tests the bridge transport.
import { it } from "@effect/vitest";
import { expect } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as NodeHttp from "node:http";
import * as GameTransport from "./GameTransport.ts";
const server = (handler: NodeHttp.RequestListener) =>
  Effect.acquireRelease(
    Effect.promise(
      () =>
        new Promise<NodeHttp.Server>((resolve) => {
          const instance = NodeHttp.createServer(handler);
          instance.listen(0, "127.0.0.1", () => resolve(instance));
        }),
    ),
    (instance) =>
      Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            instance.closeAllConnections();
            instance.close(() => resolve());
          }),
      ),
  );
it.effect("preserves bridge HTTP failures and rejects malformed command responses", () =>
  Effect.gen(function* () {
    let status = 503;
    const instance = yield* server((_request, response) => {
      response.statusCode = status;
      response.end("not JSON");
    });
    const address = instance.address();
    if (!address || typeof address === "string") throw new Error("No port");
    const transport = yield* GameTransport.GameTransport;
    const bridge = {
      generation: "g",
      port: address.port,
      token: "private-token",
      protocol: 1 as const,
    };
    expect((yield* transport.frame(bridge).pipe(Effect.flip)).code).toBe("bridge_503");
    status = 200;
    const result = yield* transport.command(bridge, { action: "state" }).pipe(Effect.result);
    expect(result).toMatchObject({ _tag: "Failure", failure: { code: "invalid_response" } });
  }).pipe(Effect.provide(GameTransport.layer), Effect.scoped),
);

it.effect("authenticates bridge calls and decodes command failures", () =>
  Effect.gen(function* () {
    const instance = yield* server((req, res) => {
      expect(req.headers.authorization).toBe("Bearer private-token");
      res.end(
        JSON.stringify({ ok: false, error: { code: "control_lost", message: "Taken over" } }),
      );
    });
    const address = instance.address();
    if (!address || typeof address === "string") throw new Error("No port");
    const transport = yield* GameTransport.GameTransport;
    const failure = yield* transport
      .command(
        { generation: "g", port: address.port, token: "private-token", protocol: 1 },
        { action: "state" },
      )
      .pipe(
        Effect.match({
          onFailure: (error) => error,
          onSuccess: () => {
            throw new Error("Expected operation to fail");
          },
        }),
      );
    expect(failure.code).toBe("control_lost");
  }).pipe(Effect.provide(GameTransport.layer), Effect.scoped),
);
it.effect("returns JPEG bytes and rejects over-limit bodies while reading", () =>
  Effect.gen(function* () {
    let large = false;
    const instance = yield* server((_, res) => {
      res.setHeader("Content-Type", "image/jpeg");
      res.end(large ? Buffer.alloc(13 * 1024 * 1024) : Buffer.from([255, 216, 255, 217]));
    });
    const address = instance.address();
    if (!address || typeof address === "string") throw new Error("No port");
    const bridge = {
      generation: "g",
      port: address.port,
      token: "private-token",
      protocol: 1 as const,
    };
    const transport = yield* GameTransport.GameTransport;
    expect(yield* transport.frame(bridge)).toEqual(new Uint8Array([255, 216, 255, 217]));
    large = true;
    expect((yield* transport.frame(bridge).pipe(Effect.flip)).code).toBe("output_limit");
  }).pipe(Effect.provide(GameTransport.layer), Effect.scoped),
);

it.effect("keeps encoded frame bytes intact and uses the authenticated video route", () =>
  Effect.gen(function* () {
    const bytes = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 9, 0, 0, 0, 1, 103, 66, 0, 31]);
    const instance = yield* server((request, response) => {
      expect(request.url).toBe("/video?after=");
      expect(request.headers.authorization).toBe("Bearer video-token");
      response.end(bytes);
    });
    const address = instance.address();
    if (!address || typeof address === "string") throw new Error("No port");
    const transport = yield* GameTransport.GameTransport;
    expect(
      yield* transport.video({
        generation: "g",
        port: address.port,
        token: "video-token",
        protocol: 1,
      }),
    ).toEqual(bytes);
  }).pipe(Effect.provide(GameTransport.layer), Effect.scoped),
);
