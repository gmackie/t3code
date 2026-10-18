import { bobOperationSchemas } from "@t3tools/contracts/bobContract";
import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  EnvironmentHttpApi,
  EnvironmentScopeRequiredError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { BobCoordinationError } from "@t3tools/contracts/bobCoordination";
import * as Schema from "effect/Schema";
import { requireEnvironmentScope } from "../auth/http.ts";
import * as ExecutionAdmission from "./ExecutionAdmission.ts";

export const layer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "execution",
  Effect.fnUntraced(function* (handlers) {
    const admission = yield* ExecutionAdmission.ExecutionAdmission;
    const respond = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.match({
          onSuccess: (value) =>
            HttpServerResponse.jsonUnsafe(value, {
              status: 200,
              headers: { "cache-control": "no-store" },
            }),
          onFailure: (error) => {
            const problem = Schema.is(BobCoordinationError)(error)
              ? error
              : Schema.is(EnvironmentScopeRequiredError)(error)
                ? { status: 403, code: "Forbidden", message: "Execution scope is required." }
                : {
                    status: 500,
                    code: "InternalError",
                    message: "Execution request could not be confirmed.",
                  };
            return HttpServerResponse.jsonUnsafe(
              {
                type: "about:blank",
                title: problem.message,
                status: problem.status,
                code: problem.code,
                retryable: problem.status >= 500,
              },
              { status: problem.status },
            );
          },
        }),
      );
    return handlers
      .handleRaw("capabilities", (args) =>
        respond(
          requireEnvironmentScope(AuthOrchestrationReadScope).pipe(
            Effect.flatMap(() =>
              args.request.json.pipe(
                Effect.mapError(
                  () =>
                    new BobCoordinationError({
                      code: "InvalidRequest",
                      status: 400,
                      message: "Invalid JSON body.",
                    }),
                ),
                Effect.flatMap((payload) =>
                  Schema.decodeUnknownEffect(bobOperationSchemas.get("GetCapabilities")!.input, {
                    onExcessProperty: "error",
                  })(payload).pipe(
                    Effect.mapError(
                      () =>
                        new BobCoordinationError({
                          code: "InvalidRequest",
                          status: 400,
                          message: "Invalid capabilities request.",
                        }),
                    ),
                  ),
                ),
                Effect.flatMap(() => admission.capabilities),
              ),
            ),
          ),
        ),
      )
      .handleRaw("submit", (args) =>
        respond(
          requireEnvironmentScope(AuthOrchestrationOperateScope).pipe(
            Effect.flatMap((principal) =>
              args.request.json.pipe(
                Effect.mapError(
                  () =>
                    new BobCoordinationError({
                      code: "InvalidRequest",
                      status: 400,
                      message: "Invalid JSON body.",
                    }),
                ),
                Effect.flatMap((payload) =>
                  admission.submit(
                    principal.subject,
                    payload,
                    args.request.headers["idempotency-key"],
                  ),
                ),
              ),
            ),
          ),
        ),
      )
      .handleRaw("find", (args) =>
        respond(
          requireEnvironmentScope(AuthOrchestrationOperateScope).pipe(
            Effect.flatMap((principal) =>
              args.request.json.pipe(
                Effect.mapError(
                  () =>
                    new BobCoordinationError({
                      code: "InvalidRequest",
                      status: 400,
                      message: "Invalid JSON body.",
                    }),
                ),
                Effect.flatMap((payload) => admission.find(principal.subject, payload)),
              ),
            ),
          ),
        ),
      );
  }),
);
