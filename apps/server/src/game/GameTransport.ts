import { UnityHookError, type UnityBridgeConnection } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as FetchHttpClient from "effect/http/FetchHttpClient";

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

const isUnityHookError = Schema.is(UnityHookError);

export class GameTransport extends Context.Service<
  GameTransport,
  {
    readonly command: (
      bridge: UnityBridgeConnection,
      input: unknown,
    ) => Effect.Effect<unknown, UnityHookError>;
    readonly video: (
      bridge: UnityBridgeConnection,
      after?: string,
    ) => Effect.Effect<Uint8Array, UnityHookError>;
    readonly frame: (bridge: UnityBridgeConnection) => Effect.Effect<Uint8Array, UnityHookError>;
  }
>()("t3/game/GameTransport") {}
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const make = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  const request = (bridge: UnityBridgeConnection, input?: unknown, media = "frame") =>
    Effect.gen(function* () {
      const url = `http://127.0.0.1:${bridge.port}/${input === undefined ? media : "command"}`;
      const outgoing =
        input === undefined
          ? HttpClientRequest.get(url)
          : yield* HttpClientRequest.bodyJson(HttpClientRequest.post(url), input);
      const response = yield* client.execute(
        outgoing.pipe(
          HttpClientRequest.setHeaders({
            Authorization: `Bearer ${bridge.token}`,
            "Content-Type": "application/json",
          }),
        ),
      );
      if (response.status < 200 || response.status >= 300)
        return yield* new UnityHookError({
          code: `bridge_${response.status}`,
          reason:
            response.status === 503
              ? "Waiting for a rendered Game view."
              : "Unity bridge disconnected or rejected the request.",
        });
      const chunks: Uint8Array[] = [];
      let size = 0;
      yield* response.stream.pipe(
        Stream.runForEach((chunk) => {
          size += chunk.byteLength;
          if (size > 12 * 1024 * 1024)
            return Effect.fail(
              new UnityHookError({
                code: "output_limit",
                reason: "Unity bridge response exceeded its limit.",
              }),
            );
          chunks.push(chunk);
          return Effect.void;
        }),
      );
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return bytes;
    }).pipe(
      Effect.mapError((error) =>
        isUnityHookError(error)
          ? error
          : new UnityHookError({
              code: "bridge_unavailable",
              reason: "Unity bridge is unavailable. Reconnect to the running target.",
            }),
      ),
      Effect.timeout("4 seconds"),
      Effect.mapError((error) =>
        isUnityHookError(error)
          ? error
          : new UnityHookError({
              code: "bridge_timeout",
              reason:
                "Unity stopped responding. Input expires automatically; reconnect before retrying.",
            }),
      ),
    );
  const command = Effect.fn("GameTransport.command")(function* (
    bridge: UnityBridgeConnection,
    input: unknown,
  ) {
    const bytes = yield* request(bridge, input);
    const result = yield* decodeJson(new TextDecoder().decode(bytes)).pipe(
      Effect.mapError(
        () =>
          new UnityHookError({
            code: "invalid_response",
            reason: "Unity returned an invalid bridge response.",
          }),
      ),
    );
    return yield* Effect.try({
      try: () => {
        if (!object(result)) throw new Error("Invalid response");
        if (result.ok !== true) {
          const error = object(result.error) ? result.error : {};
          throw new UnityHookError({
            code: typeof error.code === "string" ? error.code : "bridge_failed",
            reason:
              typeof error.message === "string" ? error.message : "Unity rejected the operation.",
          });
        }
        return result.data;
      },
      catch: (error) =>
        isUnityHookError(error)
          ? error
          : new UnityHookError({
              code: "invalid_response",
              reason: "Unity returned an invalid bridge response.",
            }),
    });
  });
  return GameTransport.of({
    command,
    frame: (bridge) => request(bridge),
    video: (bridge, after) =>
      request(bridge, undefined, "video?after=" + encodeURIComponent(after ?? "")),
  });
});
export const layer = Layer.effect(GameTransport, make).pipe(Layer.provide(FetchHttpClient.layer));
