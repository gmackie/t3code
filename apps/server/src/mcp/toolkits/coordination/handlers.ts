import { bobOperationSchemas } from "@t3tools/contracts/bobContract";
import { OrchestratorMcpFailure } from "@t3tools/contracts";
import {
  planBelongsToProject,
  type GetPlanOutput,
  type GetItemOutput,
  type ListPlansOutput,
  type GetCapabilitiesOutput,
  type CreatePlanInput,
  type BobOperationInput,
} from "@t3tools/contracts/bobCoordination";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Bob from "../../../coordination/BobCoordination.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { assertLiveCaller, readCaller } from "../../threadAccess.ts";
import { CoordinationToolkit } from "./tools.ts";

const allowed = new Set([
  "GetCapabilities",
  "ListPlans",
  "CreatePlan",
  "GetPlan",
  "GetItem",
  "ControlPlan",
  "RequestExecution",
  "RetryItem",
  "CancelItem",
]);
const denied = () =>
  new OrchestratorMcpFailure({
    code: "capability_denied",
    message: "This Bob operation is outside the calling project's authority.",
  });
const decode = <A>(operation: string, value: unknown): A =>
  Schema.decodeUnknownSync(bobOperationSchemas.get(operation)!.output)(value) as A;
/**
 * Bob plans are bound per project, so only a T3 thread caller has one. Reads
 * need nothing more; the handler checks mutations itself (a live run and a
 * full-access/default thread), since one tool carries both.
 */
const handlers = {
  bob_coordination: McpToolAccess.readsAsCaller((request: BobOperationInput) =>
    Effect.gen(function* () {
      const context = yield* readCaller();
      if (!Bob.readOperations.has(request.operation)) yield* assertLiveCaller(context);
      // Bob bindings are per project, so only a caller inside a T3 thread has one.
      const { caller } = context;
      if (caller === undefined) return yield* denied();
      if (!allowed.has(request.operation)) return yield* denied();
      if (
        !Bob.readOperations.has(request.operation) &&
        (caller.runtimeMode !== "full-access" || caller.interactionMode !== "default")
      )
        return yield* denied();
      const configuration = yield* Bob.BobConfiguration;
      const config = yield* configuration.read;
      const binding = config.projects[caller.projectId];
      if (!binding) return yield* denied();
      const coordinator = yield* Bob.BobCoordination;
      const payload = yield* Schema.decodeUnknownEffect(
        bobOperationSchemas.get(request.operation)!.input,
        { onExcessProperty: "error" },
      )(request.input);
      const fields = yield* Schema.decodeUnknownEffect(
        Schema.Record(Schema.String, Schema.Unknown),
      )(payload);
      const getPlan = (planId: unknown) =>
        coordinator
          .call({ operation: "GetPlan", input: { contractVersion: "1", resourceId: planId } })
          .pipe(Effect.map((value) => decode<GetPlanOutput>("GetPlan", value)));
      if (request.operation === "GetCapabilities") {
        const caps = decode<GetCapabilitiesOutput>(
          "GetCapabilities",
          yield* coordinator.call(request),
        );
        return {
          ...caps,
          operations: caps.operations.filter((operation) => allowed.has(operation)),
        };
      }
      if (request.operation === "ListPlans") {
        const page = decode<ListPlansOutput>("ListPlans", yield* coordinator.call(request));
        const plans = yield* Effect.forEach(
          page.plans,
          (entry) =>
            getPlan(entry.planId).pipe(
              Effect.map((plan) => (planBelongsToProject(plan.definition, binding) ? entry : null)),
            ),
          { concurrency: 4 },
        );
        return { ...page, plans: plans.filter((entry) => entry !== null) };
      }
      if (request.operation === "CreatePlan") {
        if (!planBelongsToProject((payload as CreatePlanInput).plan, binding))
          return yield* denied();
      } else {
        let planId = request.operation === "GetPlan" ? fields.resourceId : fields.planId;
        if (["GetItem", "RetryItem", "CancelItem"].includes(request.operation)) {
          const item = decode<GetItemOutput>(
            "GetItem",
            yield* coordinator.call({
              operation: "GetItem",
              input: {
                contractVersion: "1",
                resourceId: request.operation === "GetItem" ? fields.resourceId : fields.itemId,
              },
            }),
          );
          planId = item.item.planId;
        }
        const plan = yield* getPlan(planId);
        if (!planBelongsToProject(plan.definition, binding)) return yield* denied();
        if (request.operation === "GetPlan") return plan;
      }
      return yield* coordinator.call(request);
    }).pipe(
      Effect.mapError(
        () =>
          new OrchestratorMcpFailure({
            code: "invalid_request",
            message:
              "Bob could not confirm this project-scoped request. Retain the same identifiers when retrying mutations.",
          }),
      ),
    ),
  ),
} satisfies McpToolAccess.Handlers<typeof CoordinationToolkit.tools>;

export const layer = McpToolAccess.toLayer(CoordinationToolkit, handlers);
