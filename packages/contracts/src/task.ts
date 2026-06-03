import * as Schema from "effect/Schema";
import { PositiveInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const TaskProviderKind = Schema.Literals(["linear", "github-issues", "jira", "unknown"]);
export type TaskProviderKind = typeof TaskProviderKind.Type;

export const TaskState = Schema.Literals(["open", "in_progress", "done", "canceled", "unknown"]);
export type TaskState = typeof TaskState.Type;

export const TaskComment = Schema.Struct({
  id: TrimmedNonEmptyString,
  authorName: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  bodyMarkdown: TrimmedNonEmptyString,
  createdAt: Schema.optional(Schema.NullOr(Schema.DateTimeUtc)),
  updatedAt: Schema.optional(Schema.NullOr(Schema.DateTimeUtc)),
});
export type TaskComment = typeof TaskComment.Type;

export const TaskItem = Schema.Struct({
  provider: TaskProviderKind,
  id: TrimmedNonEmptyString,
  key: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  url: TrimmedNonEmptyString,
  state: TaskState,
  statusName: Schema.optional(TrimmedNonEmptyString),
  assigneeName: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  labels: Schema.Array(TrimmedNonEmptyString),
  comments: Schema.Array(TaskComment),
  descriptionMarkdown: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  suggestedBranchName: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
  updatedAt: Schema.optional(Schema.NullOr(Schema.DateTimeUtc)),
});
export type TaskItem = typeof TaskItem.Type;

export const TaskReference = TrimmedNonEmptyString;
export type TaskReference = typeof TaskReference.Type;

export const TaskLookupInput = Schema.Struct({
  provider: TaskProviderKind,
  reference: TaskReference,
  cwd: Schema.optional(TrimmedNonEmptyString),
});
export type TaskLookupInput = typeof TaskLookupInput.Type;

export const TaskListInput = Schema.Struct({
  provider: TaskProviderKind,
  query: Schema.optional(Schema.String),
  cwd: Schema.optional(TrimmedNonEmptyString),
  limit: Schema.optional(PositiveInt),
});
export type TaskListInput = typeof TaskListInput.Type;

export const TaskListResult = Schema.Struct({
  tasks: Schema.Array(TaskItem),
});
export type TaskListResult = typeof TaskListResult.Type;

export const TaskPrepareMode = Schema.Literals(["local", "worktree"]);
export type TaskPrepareMode = typeof TaskPrepareMode.Type;

export const TaskPrepareThreadInput = Schema.Struct({
  provider: TaskProviderKind,
  reference: TaskReference,
  cwd: TrimmedNonEmptyString,
  mode: TaskPrepareMode,
  threadId: Schema.optional(ThreadId),
});
export type TaskPrepareThreadInput = typeof TaskPrepareThreadInput.Type;

export const TaskPrepareThreadResult = Schema.Struct({
  task: TaskItem,
  branch: TrimmedNonEmptyString,
  worktreePath: Schema.NullOr(TrimmedNonEmptyString),
  initialPrompt: TrimmedNonEmptyString,
});
export type TaskPrepareThreadResult = typeof TaskPrepareThreadResult.Type;

export const TaskProviderDiscoveryStatus = Schema.Literals([
  "available",
  "missing-token",
  "disabled",
]);
export type TaskProviderDiscoveryStatus = typeof TaskProviderDiscoveryStatus.Type;

export const TaskProviderDiscoveryItem = Schema.Struct({
  kind: TaskProviderKind,
  label: TrimmedNonEmptyString,
  status: TaskProviderDiscoveryStatus,
  detail: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
});
export type TaskProviderDiscoveryItem = typeof TaskProviderDiscoveryItem.Type;

export class TaskProviderError extends Schema.TaggedErrorClass<TaskProviderError>()(
  "TaskProviderError",
  {
    provider: TaskProviderKind,
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Task provider ${this.provider} failed in ${this.operation}: ${this.detail}`;
  }
}
