import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthTerminalOperateScope,
  type ProjectId,
} from "@t3tools/contracts";
import {
  ReverseWorkbenchRequest,
  reverseOperationMutates,
} from "@t3tools/contracts/reverseWorkbench";
import * as ByteSize from "effect/ByteSize";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  HttpIncomingMessage,
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
  HttpServerRespondable,
} from "effect/http";
import { ServerConfig } from "../config.ts";
import { authenticateRawRouteWithScope } from "../http.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { getReverseInvestigationStore } from "./InvestigationStore.ts";
import { VeritasEvidenceClient } from "./VeritasEvidenceClient.ts";
import { WorkbenchService, type WorkbenchExtension } from "./WorkbenchService.ts";

const MAX_BODY_BYTES = 65536;

export function makeReverseWorkbenchRouteLayer(
  makeExtensions: (stateDir: string) => readonly WorkbenchExtension[] = () => [],
) {
  return Layer.unwrap(
    Effect.gen(function* () {
      const config = yield* ServerConfig;
      const projects = yield* ProjectService.ProjectService;
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
        const declared = Number(request.headers["content-length"] ?? "0");
        if (!Number.isFinite(declared) || declared > MAX_BODY_BYTES)
          return HttpServerResponse.text("Request exceeds 64 KiB", { status: 413 });
        // Chunked requests carry no content-length, so the reader itself is capped.
        const body = yield* request.text.pipe(
          Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(MAX_BODY_BYTES)),
          Effect.option,
        );
        if (Option.isNone(body))
          return HttpServerResponse.text("Request exceeds 64 KiB", { status: 413 });
        const input = yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(ReverseWorkbenchRequest),
          { onExcessProperty: "error" },
        )(body.value);
        if (reverseOperationMutates(input))
          yield* authenticateRawRouteWithScope(AuthOrchestrationOperateScope);
        if (input.operation === "lab" && reverseOperationMutates(input))
          yield* authenticateRawRouteWithScope(AuthTerminalOperateScope);
        const project = yield* projects.getById(input.projectId as ProjectId);
        if (Option.isNone(project))
          return HttpServerResponse.text("Project not found", { status: 404 });
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
