import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthTerminalOperateScope,
  type ReverseStoreError,
} from "@t3tools/contracts";
import {
  ReverseWorkbenchRequest,
  reverseOperationMutates,
} from "@t3tools/contracts/reverseWorkbench";
import * as ByteSize from "effect/ByteSize";
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
import { authenticateRawRouteWithScope } from "../http.ts";
import * as ReverseWorkbench from "./ReverseWorkbench.ts";

const MAX_BODY_BYTES = 65536;
const noStore = { "Cache-Control": "no-store" };

const decodeRequest = Schema.decodeUnknownEffect(Schema.fromJsonString(ReverseWorkbenchRequest), {
  onExcessProperty: "error",
});

const STATUS_BY_REASON: Record<ReverseStoreError["reason"], number> = {
  not_found: 404,
  outside_workspace: 400,
  invalid_file: 400,
  too_large: 413,
  unavailable: 503,
  operation_failed: 500,
};

const makeHandler = (workbench: ReverseWorkbench.ReverseWorkbench["Service"]) =>
  Effect.gen(function* () {
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
    const input = yield* decodeRequest(body.value);
    if (reverseOperationMutates(input))
      yield* authenticateRawRouteWithScope(AuthOrchestrationOperateScope);
    if (input.operation === "lab" && reverseOperationMutates(input))
      yield* authenticateRawRouteWithScope(AuthTerminalOperateScope);
    const result = yield* workbench.execute(input);
    return yield* HttpServerResponse.json(result, { headers: noStore });
  }).pipe(
    Effect.catchTags({
      EnvironmentAuthInvalidError: HttpServerRespondable.toResponse,
      EnvironmentInternalError: HttpServerRespondable.toResponse,
      EnvironmentScopeRequiredError: HttpServerRespondable.toResponse,
      ReverseStoreError: (error) =>
        HttpServerResponse.json(
          { error: error.message, reason: error.reason },
          { status: STATUS_BY_REASON[error.reason], headers: noStore },
        ),
      SchemaError: () =>
        HttpServerResponse.json(
          { error: "Invalid reverse-workbench request." },
          { status: 400, headers: noStore },
        ),
    }),
  );

// Resolved once at build: route handlers only see the per-request context.
export const reverseWorkbenchRouteLayer = Layer.unwrap(
  Effect.gen(function* () {
    const workbench = yield* ReverseWorkbench.ReverseWorkbench;
    return HttpRouter.add("POST", "/api/reverse/workbench", makeHandler(workbench));
  }),
);
