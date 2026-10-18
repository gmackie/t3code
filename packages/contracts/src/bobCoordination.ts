import * as Schema from "effect/Schema";
import { ModelSelection } from "./modelSelection.ts";
import { RuntimeMode } from "./providerPolicy.ts";
export type * from "./bob/types.generated.ts";

export const BobOperationInput = Schema.Struct({
  operation: Schema.String,
  input: Schema.Unknown,
  idempotencyKey: Schema.optional(Schema.String),
});
export type BobOperationInput = typeof BobOperationInput.Type;
export class BobCoordinationError extends Schema.TaggedError<BobCoordinationError>()(
  "BobCoordinationError",
  {
    code: Schema.String,
    status: Schema.Number,
    message: Schema.String,
  },
  { httpApiStatus: 409 },
) {}
export const BobExecutionTarget = Schema.Struct({
  environmentId: Schema.String,
  projectId: Schema.String,
  repository: Schema.Struct({ integrationId: Schema.String, repositoryId: Schema.String }),
});
export const BobIssueProject = Schema.Struct({
  integrationId: Schema.String,
  workspaceId: Schema.String,
  teamId: Schema.String,
  projectId: Schema.String,
});
export const BobProjectBinding = Schema.Struct({
  target: BobExecutionTarget,
  issueProject: BobIssueProject,
});
export type BobProjectBinding = typeof BobProjectBinding.Type;
export const BobLocalConfiguration = Schema.Struct({
  coordinator: Schema.optional(Schema.Struct({ baseUrl: Schema.String, authToken: Schema.String })),
  receiptCoordinator: Schema.optional(
    Schema.Struct({ baseUrl: Schema.String, authToken: Schema.String }),
  ),
  projects: Schema.Record(Schema.String, BobProjectBinding),
  executionProfiles: Schema.Record(
    Schema.String,
    Schema.Struct({ modelSelection: ModelSelection, runtimeMode: RuntimeMode }),
  ),
});
export type BobLocalConfiguration = typeof BobLocalConfiguration.Type;
export const BobConnectionState = Schema.Struct({
  configured: Schema.Boolean,
  projects: Schema.Record(Schema.String, BobProjectBinding),
  executionProfiles: Schema.Array(Schema.String),
});
export type BobConnectionState = typeof BobConnectionState.Type;

export function planBelongsToProject(
  plan: import("./bob/types.generated.ts").GetPlanOutput["definition"],
  binding: BobProjectBinding,
): boolean {
  return (
    plan.items.length > 0 &&
    plan.items.every(
      (item) =>
        item.target.environmentId === binding.target.environmentId &&
        item.target.projectId === binding.target.projectId &&
        item.target.repository.integrationId === binding.target.repository.integrationId &&
        item.target.repository.repositoryId === binding.target.repository.repositoryId &&
        item.issue.integrationId === binding.issueProject.integrationId &&
        item.issue.workspaceId === binding.issueProject.workspaceId &&
        item.issue.teamId === binding.issueProject.teamId &&
        item.issue.projectId === binding.issueProject.projectId,
    )
  );
}
