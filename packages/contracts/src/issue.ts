import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { IsoDateTime, PositiveInt, ProjectId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const IssueProviderKind = Schema.Literals(["linear", "github-issues", "jira", "unknown"]);
export type IssueProviderKind = typeof IssueProviderKind.Type;

export const IssueState = Schema.Literals(["open", "in_progress", "done", "canceled", "unknown"]);
export type IssueState = typeof IssueState.Type;

export const IssueComment = Schema.Struct({
  id: TrimmedNonEmptyString,
  authorName: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  bodyMarkdown: TrimmedNonEmptyString,
  createdAt: Schema.optional(Schema.NullOr(Schema.DateTimeUtc)),
  updatedAt: Schema.optional(Schema.NullOr(Schema.DateTimeUtc)),
});
export type IssueComment = typeof IssueComment.Type;

export const IssueItem = Schema.Struct({
  provider: IssueProviderKind,
  id: TrimmedNonEmptyString,
  key: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  state: IssueState,
  statusId: Schema.optional(TrimmedNonEmptyString),
  statusName: Schema.optional(TrimmedNonEmptyString),
  assigneeName: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  labels: Schema.Array(TrimmedNonEmptyString),
  comments: Schema.Array(IssueComment),
  descriptionMarkdown: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  suggestedBranchName: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  updatedAt: Schema.optional(Schema.NullOr(IsoDateTime)),
});
export type IssueItem = typeof IssueItem.Type;

export const IssueListResult = Schema.Struct({
  issues: Schema.Array(IssueItem),
});
export type IssueListResult = typeof IssueListResult.Type;

export const ProjectIssueListInput = Schema.Struct({
  projectId: ProjectId,
  query: Schema.optional(Schema.String),
  limit: Schema.optional(PositiveInt),
});
export type ProjectIssueListInput = typeof ProjectIssueListInput.Type;

export const ProjectIssueStatus = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  state: IssueState,
});
export type ProjectIssueStatus = typeof ProjectIssueStatus.Type;

export const ProjectIssueStatusListInput = Schema.Struct({
  projectId: ProjectId,
});
export type ProjectIssueStatusListInput = typeof ProjectIssueStatusListInput.Type;

export const ProjectIssueStatusListResult = Schema.Struct({
  statuses: Schema.Array(ProjectIssueStatus),
});
export type ProjectIssueStatusListResult = typeof ProjectIssueStatusListResult.Type;

export const ProjectIssueCreateInput = Schema.Struct({
  projectId: ProjectId,
  title: TrimmedNonEmptyString,
  descriptionMarkdown: Schema.optional(Schema.String),
  statusId: Schema.optional(TrimmedNonEmptyString),
  statusName: Schema.optional(TrimmedNonEmptyString),
});
export type ProjectIssueCreateInput = typeof ProjectIssueCreateInput.Type;

export const ProjectIssueCreateResult = Schema.Struct({
  issue: IssueItem,
});
export type ProjectIssueCreateResult = typeof ProjectIssueCreateResult.Type;

export const ProjectIssueStatusUpdateInput = Schema.Struct({
  projectId: ProjectId,
  issueId: TrimmedNonEmptyString,
  statusId: Schema.optional(TrimmedNonEmptyString),
  statusName: Schema.optional(TrimmedNonEmptyString),
});
export type ProjectIssueStatusUpdateInput = typeof ProjectIssueStatusUpdateInput.Type;

export const ProjectIssueStatusUpdateResult = Schema.Struct({
  issue: IssueItem,
});
export type ProjectIssueStatusUpdateResult = typeof ProjectIssueStatusUpdateResult.Type;

export const LinearIssueProject = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  teamKey: Schema.optional(TrimmedNonEmptyString),
  teamName: Schema.optional(TrimmedNonEmptyString),
  mappedProjectIds: Schema.Array(ProjectId).pipe(Schema.withDecodingDefault(Effect.succeed([]))),
});
export type LinearIssueProject = typeof LinearIssueProject.Type;

export const LinearIssueValidationResult = Schema.Struct({
  ok: Schema.Boolean,
  workspaceName: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  userName: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  projects: Schema.Array(LinearIssueProject),
  error: Schema.optional(Schema.NullOr(Schema.String)),
});
export type LinearIssueValidationResult = typeof LinearIssueValidationResult.Type;

export class IssueProviderError extends Schema.TaggedErrorClass<IssueProviderError>()(
  "IssueProviderError",
  {
    provider: IssueProviderKind,
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Issue provider ${this.provider} failed in ${this.operation}: ${this.detail}`;
  }
}
