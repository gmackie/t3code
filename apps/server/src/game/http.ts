import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  GameRequest,
  GameViewerInput,
  UnityHookError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
  HttpServerRespondable,
} from "effect/http";
import { authenticateRawRouteWithScope } from "../http.ts";
import * as GameSessions from "./GameSessions.ts";
import { gameViewerDocument } from "./viewer.ts";

const decodeTicket = Schema.decodeUnknownEffect(GameViewerInput);
const decodeRequest = Schema.decodeUnknownEffect(GameRequest);
const errorResponse = (error: UnityHookError) =>
  HttpServerResponse.json(
    { error: error.code, message: error.message },
    { status: error.code === "viewer_expired" ? 401 : error.code === "read_only" ? 403 : 400 },
  );
const handleErrors = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.catch((error) => {
      if (error instanceof UnityHookError) return errorResponse(error);
      if (HttpServerRespondable.isRespondable(error))
        return HttpServerRespondable.toResponse(error);
      return HttpServerResponse.json(
        { error: "request_failed", message: "Unable to complete game request." },
        { status: 500 },
      );
    }),
  );
const ticket = (request: HttpServerRequest.HttpServerRequest) =>
  request.headers["x-t3-game-ticket"] ?? "";
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const service = yield* GameSessions.GameSessions;
    const handled = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      handleErrors(effect.pipe(Effect.provideService(GameSessions.GameSessions, service)));
    return Layer.mergeAll(
      HttpRouter.add(
        "POST",
        "/api/game/ticket",
        handled(
          Effect.gen(function* () {
            const auth = yield* authenticateRawRouteWithScope(AuthOrchestrationReadScope);
            const request = yield* HttpServerRequest.HttpServerRequest;
            const input = yield* request.json.pipe(
              Effect.flatMap(decodeTicket),
              Effect.mapError(
                () =>
                  new UnityHookError({
                    code: "invalid_request",
                    reason: "Invalid viewer request.",
                  }),
              ),
            );
            const service = yield* GameSessions.GameSessions;
            return yield* HttpServerResponse.json(
              yield* service.ticket({
                ...input,
                canOperate: auth.scopes.includes(AuthOrchestrationOperateScope),
                role: "human",
              }),
              { headers: { "Cache-Control": "no-store" } },
            );
          }),
        ),
      ),
      HttpRouter.add(
        "GET",
        "/api/game/viewer",
        Effect.succeed(
          HttpServerResponse.text(gameViewerDocument, {
            contentType: "text/html",
            headers: {
              "Cache-Control": "no-store",
              "Referrer-Policy": "no-referrer",
              "Content-Security-Policy":
                "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; frame-src blob:; object-src 'none'",
            },
          }),
        ),
      ),
      HttpRouter.add(
        "GET",
        "/api/game/config",
        handled(
          Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest;
            const service = yield* GameSessions.GameSessions;
            return yield* HttpServerResponse.json(yield* service.configuration(ticket(request)), {
              headers: { "Cache-Control": "no-store" },
            });
          }),
        ),
      ),
      HttpRouter.add(
        "POST",
        "/api/game/command",
        handled(
          Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest;
            const input = yield* request.json.pipe(
              Effect.flatMap(decodeRequest),
              Effect.mapError(
                () =>
                  new UnityHookError({ code: "invalid_request", reason: "Invalid game command." }),
              ),
            );
            const service = yield* GameSessions.GameSessions;
            return yield* HttpServerResponse.json(yield* service.request(ticket(request), input), {
              headers: { "Cache-Control": "no-store" },
            });
          }),
        ),
      ),
      HttpRouter.add(
        "GET",
        "/api/game/video/:sessionId",
        handled(
          Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest;
            const { sessionId } = yield* HttpRouter.params;
            const service = yield* GameSessions.GameSessions;
            return HttpServerResponse.uint8Array(
              yield* service.video(
                ticket(request),
                sessionId ?? "",
                new URL(request.url, "http://localhost").searchParams.get("after") ?? "",
              ),
              { contentType: "application/octet-stream", headers: { "Cache-Control": "no-store" } },
            );
          }),
        ),
      ),
      HttpRouter.add(
        "GET",
        "/api/game/frame/:sessionId",
        handled(
          Effect.gen(function* () {
            const request = yield* HttpServerRequest.HttpServerRequest;
            const { sessionId } = yield* HttpRouter.params;
            const service = yield* GameSessions.GameSessions;
            return HttpServerResponse.uint8Array(
              yield* service.frame(ticket(request), sessionId ?? ""),
              { contentType: "image/jpeg", headers: { "Cache-Control": "no-store" } },
            );
          }),
        ),
      ),
    );
  }),
);
