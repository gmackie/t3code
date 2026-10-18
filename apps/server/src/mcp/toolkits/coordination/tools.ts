import { OrchestratorMcpFailure } from "@t3tools/contracts";
import { BobOperationInput } from "@t3tools/contracts/bobCoordination";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as Bob from "../../../coordination/BobCoordination.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

export const CoordinationToolkit = Toolkit.make(
  Tool.make("bob_coordination", {
    description:
      "Manage Bob plans for the calling project. Supports GetCapabilities, ListPlans, CreatePlan, GetPlan, GetItem, ControlPlan, RequestExecution, RetryItem and CancelItem. Inputs follow the ForgeC contract. Mutations must retain commandId/requestId and matching idempotencyKey across uncertain retries. Execution does not certify PR/CI or production completion.",
    parameters: BobOperationInput,
    success: Schema.Unknown,
    failure: OrchestratorMcpFailure,
    failureMode: "return" as const,
    dependencies: [
      McpInvocationContext.McpInvocationContext,
      ThreadManagement.ThreadManagementService,
      Bob.BobCoordination,
      Bob.BobConfiguration,
    ],
  })
    .annotate(Tool.Destructive, true)
    .annotate(Tool.OpenWorld, true),
);
