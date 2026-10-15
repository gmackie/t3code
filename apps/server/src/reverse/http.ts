import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthTerminalOperateScope,
} from "@t3tools/contracts";
import {
  ReverseWorkbenchRequest,
  reverseOperationMutates,
} from "@t3tools/contracts/reverseWorkbench";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
  HttpServerRespondable,
} from "effect/http";
import { ServerConfig } from "../config.ts";
import { authenticateRawRouteWithScope } from "../http.ts";
import { getReverseInvestigationStore } from "./InvestigationStore.ts";
import { VeritasEvidenceClient } from "./VeritasEvidenceClient.ts";
import { WorkbenchService, type WorkbenchExtension } from "./WorkbenchService.ts";

export function makeReverseWorkbenchRouteLayer(
  makeExtensions: (stateDir: string) => readonly WorkbenchExtension[] = () => [],
) {
  return Layer.unwrap(
    Effect.gen(function* () {
      const config = yield* ServerConfig;
      const url = yield* Config.String("VERITAS_URL").pipe(Config.withDefault(""));
      const token = yield* Config.String("VERITAS_API_TOKEN").pipe(Config.withDefault(""));
      const service = yield* Effect.acquireRelease(
        Effect.sync(
          () =>
            new WorkbenchService(
              getReverseInvestigationStore(config.stateDir),
              new VeritasEvidenceClient(url && token ? { url, token } : null),
              makeExtensions(config.stateDir),
            ),
        ),
        (value) => Effect.promise(() => value.close()),
      );
      const handler = Effect.gen(function* () {
        yield* authenticateRawRouteWithScope(AuthOrchestrationReadScope);
        const request = yield* HttpServerRequest.HttpServerRequest;
        if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json"))
          return HttpServerResponse.text("JSON content type required", { status: 415 });
        const body = yield* request.text;
        if (new TextEncoder().encode(body).byteLength > 65536)
          return HttpServerResponse.text("Request exceeds 64 KiB", { status: 413 });
        const input = yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(ReverseWorkbenchRequest),
          { onExcessProperty: "error" },
        )(body);
        if (reverseOperationMutates(input))
          yield* authenticateRawRouteWithScope(AuthOrchestrationOperateScope);
        if (input.operation === "lab" && reverseOperationMutates(input))
          yield* authenticateRawRouteWithScope(AuthTerminalOperateScope);
        const result = yield* Effect.tryPromise(() => service.execute(input));
        return yield* HttpServerResponse.json(result, { headers: { "Cache-Control": "no-store" } });
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
                  : "Invalid reverse-workbench request.",
            },
            { status: 400, headers: { "Cache-Control": "no-store" } },
          ),
        ),
      );
      return HttpRouter.add("POST", "/api/reverse/workbench", handler);
    }),
  );
}
export const reverseWorkbenchRouteLayer = makeReverseWorkbenchRouteLayer();
