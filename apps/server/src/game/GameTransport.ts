import { UnityHookError, type UnityBridgeConnection } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export class GameTransport extends Context.Service<
  GameTransport,
  {
    readonly command: (
      bridge: UnityBridgeConnection,
      input: unknown,
    ) => Effect.Effect<unknown, UnityHookError>;
    readonly frame: (bridge: UnityBridgeConnection) => Effect.Effect<Uint8Array, UnityHookError>;
  }
>()("t3/game/GameTransport") {}
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const make = Effect.sync(() => {
  const request = (bridge: UnityBridgeConnection, input?: unknown) =>
    Effect.tryPromise({
      try: async (signal) => {
        const response = await fetch(
          `http://127.0.0.1:${bridge.port}/${input === undefined ? "frame" : "command"}`,
          {
            method: input === undefined ? "GET" : "POST",
            headers: {
              Authorization: `Bearer ${bridge.token}`,
              "Content-Type": "application/json",
            },
            ...(input === undefined ? {} : { body: JSON.stringify(input) }),
            signal,
          },
        );
        if (!response.ok)
          throw new UnityHookError({
            code: `bridge_${response.status}`,
            reason:
              response.status === 503
                ? "Waiting for a rendered Game view."
                : "Unity bridge disconnected or rejected the request.",
          });
        const reader = response.body?.getReader();
        if (!reader) throw new Error("Missing response body");
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 12 * 1024 * 1024)
              throw new UnityHookError({
                code: "output_limit",
                reason: "Unity bridge response exceeded its limit.",
              });
            chunks.push(value);
          }
        } finally {
          await reader.cancel();
          reader.releaseLock();
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return bytes;
      },
      catch: (error) =>
        error instanceof UnityHookError
          ? error
          : new UnityHookError({
              code: "bridge_unavailable",
              reason: "Unity bridge is unavailable. Reconnect to the running target.",
            }),
    }).pipe(
      Effect.timeout("4 seconds"),
      Effect.mapError((error) =>
        error instanceof UnityHookError
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
    return yield* Effect.try({
      try: () => {
        const result: unknown = JSON.parse(new TextDecoder().decode(bytes));
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
        error instanceof UnityHookError
          ? error
          : new UnityHookError({
              code: "invalid_response",
              reason: "Unity returned an invalid bridge response.",
            }),
    });
  });
  return GameTransport.of({ command, frame: (bridge) => request(bridge) });
});
export const layer = Layer.effect(GameTransport, make);
