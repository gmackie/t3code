import { bobOperationSchemas } from "@t3tools/contracts/bobContract";
import {
  BobCoordinationError,
  BobLocalConfiguration,
  type BobConnectionState,
  type BobOperationInput,
} from "@t3tools/contracts/bobCoordination";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";
import * as ServerConfig from "../config.ts";

export const readOperations = new Set([
  "GetCapabilities",
  "ListPlans",
  "GetPlan",
  "GetItem",
  "GetOperation",
  "ReadEvents",
]);
const viewerOperations = new Set([
  ...readOperations,
  "CreatePlan",
  "UpdatePlan",
  "ControlPlan",
  "RequestExecution",
  "RetryItem",
  "CancelItem",
  "TriggerPlan",
  "RequestValidation",
  "RequestRelease",
  "RequestDeployment",
  "ResolveInput",
  "ReconcileItem",
]);
export class BobConfiguration extends Context.Service<
  BobConfiguration,
  { readonly read: Effect.Effect<BobLocalConfiguration, BobCoordinationError> }
>()("t3/coordination/BobCoordination/BobConfiguration") {}
export const configurationLayer = Layer.effect(
  BobConfiguration,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const config = yield* ServerConfig.ServerConfig;
    const path = `${config.stateDir}/bob-coordination.json`;
    return BobConfiguration.of({
      read: Effect.gen(function* () {
        const exists = yield* fs.exists(path).pipe(
          Effect.mapError(
            () =>
              new BobCoordinationError({
                code: "ConfigurationUnavailable",
                status: 503,
                message: "Bob configuration could not be read.",
              }),
          ),
        );
        if (!exists) return { projects: {}, executionProfiles: {} };
        return yield* fs.readFileString(path).pipe(
          Effect.flatMap((raw) =>
            Schema.decodeUnknownEffect(Schema.fromJsonString(BobLocalConfiguration))(raw),
          ),
          Effect.mapError(
            () =>
              new BobCoordinationError({
                code: "InvalidConfiguration",
                status: 503,
                message: "Bob configuration is invalid.",
              }),
          ),
        );
      }),
    });
  }),
);

export class BobCoordination extends Context.Service<
  BobCoordination,
  {
    readonly state: Effect.Effect<BobConnectionState, BobCoordinationError>;
    readonly call: (input: BobOperationInput) => Effect.Effect<unknown, BobCoordinationError>;
  }
>()("t3/coordination/BobCoordination") {}
const make = Effect.gen(function* () {
  const configuration = yield* BobConfiguration;
  const httpClient = yield* HttpClient.HttpClient;
  const call = Effect.fn("BobCoordination.call")(function* (request: BobOperationInput) {
    const spec = bobOperationSchemas.get(request.operation);
    if (!spec || !viewerOperations.has(request.operation))
      return yield* new BobCoordinationError({
        code: "CapabilityUnavailable",
        status: 501,
        message: "This operation is not a coordinator viewer operation.",
      });
    const input = yield* Schema.decodeUnknownEffect(spec.input, { onExcessProperty: "error" })(
      request.input,
    ).pipe(
      Effect.mapError(
        () =>
          new BobCoordinationError({
            code: "InvalidRequest",
            status: 400,
            message: "Request does not match the ForgeC contract.",
          }),
      ),
    );
    const config = yield* configuration.read;
    if (!config.coordinator)
      return yield* new BobCoordinationError({
        code: "NotConfigured",
        status: 503,
        message: "Connect this environment to Bob to manage work.",
      });
    const endpoint = config.coordinator;
    return yield* Effect.gen(function* () {
      const base = yield* Effect.try(() => new URL(endpoint.baseUrl));
      if (base.username || base.password || !["http:", "https:"].includes(base.protocol))
        return yield* new BobCoordinationError({
          code: "InvalidConfiguration",
          status: 503,
          message: "Invalid Bob endpoint.",
        });
      const response = yield* HttpClientRequest.post(new URL(spec.path, base).toString()).pipe(
        HttpClientRequest.setHeaders({
          authorization: `Bearer ${endpoint.authToken}`,
          ...(request.idempotencyKey ? { "idempotency-key": request.idempotencyKey } : {}),
        }),
        HttpClientRequest.bodyJson(input),
        Effect.flatMap(httpClient.execute),
      );
      const raw = yield* response.json;
      if (response.status !== 200) {
        const problem = yield* Schema.decodeUnknownEffect(
          Schema.Struct({ code: Schema.String, title: Schema.String }),
        )(raw);
        return yield* new BobCoordinationError({
          code: problem.code,
          status: response.status,
          message: problem.title,
        });
      }
      return yield* Schema.decodeUnknownEffect(spec.output, { onExcessProperty: "error" })(raw);
    }).pipe(
      Effect.timeout("15 seconds"),
      Effect.mapError((cause) =>
        Schema.is(BobCoordinationError)(cause)
          ? cause
          : new BobCoordinationError({
              code: "EnvironmentUnavailable",
              status: 503,
              message:
                "Bob could not confirm this request. Retry mutations with the same identifier.",
            }),
      ),
    );
  });
  return BobCoordination.of({
    call,
    state: configuration.read.pipe(
      Effect.map((config) => ({
        configured: config.coordinator !== undefined,
        projects: config.projects,
        executionProfiles: Object.keys(config.executionProfiles),
      })),
    ),
  });
});
export const layer = Layer.effect(BobCoordination, make);
