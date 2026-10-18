import * as Schema from "effect/Schema";
import * as SchemaRepresentation from "effect/SchemaRepresentation";
import api from "./bob/openapi.generated.json" with { type: "json" };
import type * as JsonSchema from "effect/JsonSchema";
import type {
  SubmitExecutionInput,
  SubmitExecutionOutput,
  FindExecutionInput,
} from "./bob/types.generated.ts";

// The checked-in ForgeC document is trusted compiler output. Excess properties
// are rejected at decode sites so credentials cannot hide in persisted payloads.
const operations = Object.values(api.paths).flatMap(Object.values);
export const bobOperationSchemas = new Map(
  operations.map((operation) => [
    operation.operationId.split("/").at(-1)!,
    {
      path: Object.entries(api.paths).find(([, methods]) =>
        Object.values(methods).some((candidate) => candidate.operationId === operation.operationId),
      )![0],
      input: SchemaRepresentation.fromJsonSchemaDocument(
        {
          dialect: "draft-2020-12",
          schema: operation.requestBody.content["application/json"].schema as JsonSchema.JsonSchema,
          definitions: {},
        },
        { patterns: "apply" },
      ) as Schema.Codec<unknown>,
      output: SchemaRepresentation.fromJsonSchemaDocument(
        {
          dialect: "draft-2020-12",
          schema: operation.responses["200"].content["application/json"]
            .schema as JsonSchema.JsonSchema,
          definitions: {},
        },
        { patterns: "apply" },
      ) as Schema.Codec<unknown>,
    },
  ]),
);
export const BobExecutionRequest = bobOperationSchemas.get("SubmitExecution")!
  .input as Schema.Codec<SubmitExecutionInput>;
export const BobExecutionAdmission = bobOperationSchemas.get("SubmitExecution")!
  .output as Schema.Codec<SubmitExecutionOutput>;
export const BobFindExecution = bobOperationSchemas.get("FindExecution")!
  .input as Schema.Codec<FindExecutionInput>;
