// @effect-diagnostics nodeBuiltinImport:off
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  VeritasCadAction,
} from "@t3tools/contracts";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
  HttpServerRespondable,
} from "effect/unstable/http";
import { ServerConfig } from "../config.ts";
import { authenticateRawRouteWithScope } from "../http.ts";
import { kicadViewerSession } from "./http.ts";
import { VeritasBridge } from "./VeritasBridge.ts";

export const kicadVeritasRouteLayer = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const url = yield* Config.string("VERITAS_URL").pipe(Config.withDefault(""));
    const token = yield* Config.string("VERITAS_API_TOKEN").pipe(Config.withDefault(""));
    const publicUrl = yield* Config.string("VERITAS_CAD_PUBLIC_URL").pipe(Config.withDefault(""));
    const bridge = new VeritasBridge(
      config.stateDir,
      url && token ? { url, token, publicUrl } : null,
    );
    const access = (operate: boolean) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const requestUrl = HttpServerRequest.toURL(request);
        if (Option.isNone(requestUrl)) return null;
        const session = kicadViewerSession(requestUrl.value);
        if (session) return operate && !session.canOperate ? null : session;
        const authorization = yield* authenticateRawRouteWithScope(
          operate ? AuthOrchestrationOperateScope : AuthOrchestrationReadScope,
        );
        const cwd = requestUrl.value.searchParams.get("cwd");
        if (!cwd) return null;
        const fs = yield* FileSystem.FileSystem;
        return {
          cwd: yield* fs.realPath(cwd),
          canOperate: authorization.scopes.includes(AuthOrchestrationOperateScope),
        };
      });
    const handle = (operate: boolean) =>
      Effect.gen(function* () {
        const session = yield* access(operate);
        if (!session)
          return HttpServerResponse.text(
            "Reconnect with workspace operation access to use this action.",
            { status: 403 },
          );
        if (operate) {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const action = yield* request.json.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(VeritasCadAction)),
          );
          yield* Effect.tryPromise(() => bridge.action(session.cwd, action));
        }
        const status = yield* Effect.tryPromise(() =>
          bridge.status(session.cwd, session.canOperate),
        );
        return yield* HttpServerResponse.json(status, { headers: { "Cache-Control": "no-store" } });
      }).pipe(
        Effect.catchTags({
          EnvironmentAuthInvalidError: HttpServerRespondable.toResponse,
          EnvironmentInternalError: HttpServerRespondable.toResponse,
          EnvironmentScopeRequiredError: HttpServerRespondable.toResponse,
        }),
        Effect.catch((error) =>
          HttpServerResponse.json(
            {
              error:
                error._tag === "UnknownError" && error.cause instanceof Error
                  ? error.cause.message
                  : "Unable to complete the Veritas request. Check its connection and project settings.",
            },
            { status: 400, headers: { "Cache-Control": "no-store" } },
          ),
        ),
      );
    return Layer.mergeAll(
      HttpRouter.add("GET", "/api/kicad/veritas", handle(false)),
      HttpRouter.add("POST", "/api/kicad/veritas", handle(true)),
      HttpRouter.add(
        "GET",
        "/api/kicad/veritas/snapshot/:token",
        Effect.gen(function* () {
          const request = yield* HttpServerRequest.HttpServerRequest;
          const requestUrl = HttpServerRequest.toURL(request);
          const snapshotToken = Option.isSome(requestUrl)
            ? (requestUrl.value.pathname.split("/").at(-1) ?? "")
            : "";
          const path = yield* Effect.tryPromise(() => bridge.snapshotPath(snapshotToken));
          if (!path)
            return HttpServerResponse.text("Design snapshot expired or not found.", {
              status: 404,
            });
          return yield* HttpServerResponse.file(path, {
            headers: {
              "Content-Type": "application/zip",
              "Cache-Control": "no-store",
              "Referrer-Policy": "no-referrer",
              "Content-Disposition": "attachment; filename=design.zip",
            },
          });
        }),
      ),
    );
  }),
);
