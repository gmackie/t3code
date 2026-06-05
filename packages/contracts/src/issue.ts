import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { PositiveInt, ProjectId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ChangeRequestState, SourceControlProviderKind } from "./sourceControl.ts";

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
  statusName: Schema.optional(TrimmedNonEmptyString),
  assigneeName: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  labels: Schema.Array(TrimmedNonEmptyString),
  comments: Schema.Array(IssueComment),
  descriptionMarkdown: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  suggestedBranchName: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  updatedAt: Schema.optional(Schema.NullOr(Schema.DateTimeUtc)),
});
export type IssueItem = typeof IssueItem.Type;

export const IssueReference = TrimmedNonEmptyString;
export type IssueReference = typeof IssueReference.Type;

export const IssueLookupInput = Schema.Struct({
  provider: IssueProviderKind,
  reference: IssueReference,
  cwd: Schema.optional(TrimmedNonEmptyString),
});
export type IssueLookupInput = typeof IssueLookupInput.Type;

export const IssueListInput = Schema.Struct({
  provider: IssueProviderKind,
  query: Schema.optional(Schema.String),
  cwd: Schema.optional(TrimmedNonEmptyString),
  limit: Schema.optional(PositiveInt),
});
export type IssueListInput = typeof IssueListInput.Type;

export const IssueListResult = Schema.Struct({
  issues: Schema.Array(IssueItem),
});
export type IssueListResult = typeof IssueListResult.Type;

export const LinearIssueProjectAssociation = Schema.Struct({
  projectId: TrimmedNonEmptyString,
  projectName: Schema.optional(TrimmedNonEmptyString),
  teamKey: Schema.optional(TrimmedNonEmptyString),
});
export type LinearIssueProjectAssociation = typeof LinearIssueProjectAssociation.Type;

export const GitHubIssueProjectAssociation = Schema.Struct({
  repository: TrimmedNonEmptyString,
});
export type GitHubIssueProjectAssociation = typeof GitHubIssueProjectAssociation.Type;

export const IssueProjectAssociation = Schema.Struct({
  provider: IssueProviderKind,
  projectId: ProjectId,
  repositoryKey: TrimmedNonEmptyString,
  linear: Schema.optional(LinearIssueProjectAssociation),
  github: Schema.optional(GitHubIssueProjectAssociation),
});
export type IssueProjectAssociation = typeof IssueProjectAssociation.Type;

export const IssuePrepareMode = Schema.Literals(["local", "worktree"]);
export type IssuePrepareMode = typeof IssuePrepareMode.Type;

export const IssuePrepareThreadInput = Schema.Struct({
  provider: IssueProviderKind,
  reference: IssueReference,
  cwd: TrimmedNonEmptyString,
  mode: IssuePrepareMode,
  threadId: Schema.optional(ThreadId),
});
export type IssuePrepareThreadInput = typeof IssuePrepareThreadInput.Type;

export const IssuePrepareThreadResult = Schema.Struct({
  issue: IssueItem,
  association: Schema.optional(IssueProjectAssociation),
  branch: TrimmedNonEmptyString,
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  initialPrompt: TrimmedNonEmptyString,
});
export type IssuePrepareThreadResult = typeof IssuePrepareThreadResult.Type;

export const IssueLifecycleEvent = Schema.Literals([
  "thread_started",
  "change_request_opened",
  "change_request_merged",
]);
export type IssueLifecycleEvent = typeof IssueLifecycleEvent.Type;

export const IssueLifecycleChangeRequest = Schema.Struct({
  provider: SourceControlProviderKind,
  number: PositiveInt,
  title: TrimmedNonEmptyString,
  url: Schema.String,
  state: ChangeRequestState,
});
export type IssueLifecycleChangeRequest = typeof IssueLifecycleChangeRequest.Type;

export const IssueLifecycleUpdateInput = Schema.Struct({
  provider: IssueProviderKind,
  reference: IssueReference,
  cwd: TrimmedNonEmptyString,
  event: IssueLifecycleEvent,
  changeRequest: Schema.optional(IssueLifecycleChangeRequest),
});
export type IssueLifecycleUpdateInput = typeof IssueLifecycleUpdateInput.Type;

export const IssueLifecycleUpdateResult = Schema.Struct({
  issue: Schema.optional(IssueItem),
  statusChanged: Schema.Boolean,
  previousStatusName: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  nextStatusName: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
});
export type IssueLifecycleUpdateResult = typeof IssueLifecycleUpdateResult.Type;

export const IssueProviderDiscoveryStatus = Schema.Literals([
  "available",
  "missing-token",
  "disabled",
]);
export type IssueProviderDiscoveryStatus = typeof IssueProviderDiscoveryStatus.Type;

export const IssueProviderDiscoveryItem = Schema.Struct({
  kind: IssueProviderKind,
  label: TrimmedNonEmptyString,
  status: IssueProviderDiscoveryStatus,
  detail: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
});
export type IssueProviderDiscoveryItem = typeof IssueProviderDiscoveryItem.Type;

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
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Issue provider ${this.provider} failed in ${this.operation}: ${this.detail}`;
  }
}
