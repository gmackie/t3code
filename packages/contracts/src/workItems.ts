import * as Schema from "effect/Schema";

export const WorkSourceCapability = Schema.Literals([
  "list",
  "detail",
  "status-update",
  "create",
  "dispatch",
  "comments",
  "artifacts",
]);
export type WorkSourceCapability = typeof WorkSourceCapability.Type;

export const WorkItemScope = Schema.Struct({
  projectId: Schema.optional(Schema.String),
  threadId: Schema.optional(Schema.String),
  query: Schema.optional(Schema.String),
});
export type WorkItemScope = typeof WorkItemScope.Type;

export const WorkItemStatus = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  category: Schema.Literals(["backlog", "active", "blocked", "done", "cancelled"]),
});
export type WorkItemStatus = typeof WorkItemStatus.Type;

export const WorkItem = Schema.Struct({
  providerId: Schema.String,
  id: Schema.String,
  title: Schema.String,
  description: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  labels: Schema.optional(Schema.Array(Schema.String)),
  status: WorkItemStatus,
  scope: WorkItemScope,
  updatedAt: Schema.optional(Schema.String),
});
export type WorkItem = typeof WorkItem.Type;

export const WorkItemDetail = Schema.Struct({
  item: WorkItem,
  body: Schema.optional(Schema.String),
  comments: Schema.optional(
    Schema.Array(Schema.Struct({ id: Schema.String, body: Schema.String, author: Schema.String })),
  ),
});
export type WorkItemDetail = typeof WorkItemDetail.Type;

export const PluginRunSummary = Schema.Struct({
  providerId: Schema.String,
  id: Schema.String,
  status: Schema.Literals(["queued", "running", "succeeded", "failed", "cancelled"]),
  workItemId: Schema.optional(Schema.String),
  threadId: Schema.optional(Schema.String),
  startedAt: Schema.optional(Schema.String),
  finishedAt: Schema.optional(Schema.String),
});
export type PluginRunSummary = typeof PluginRunSummary.Type;

export const UpdateWorkItemStatusInput = Schema.Struct({
  providerId: Schema.String,
  itemId: Schema.String,
  statusId: Schema.String,
});
export type UpdateWorkItemStatusInput = typeof UpdateWorkItemStatusInput.Type;
export const CreateWorkItemInput = Schema.Struct({
  providerId: Schema.String,
  scope: WorkItemScope,
  title: Schema.String,
  body: Schema.optional(Schema.String),
});
export type CreateWorkItemInput = typeof CreateWorkItemInput.Type;
export const DispatchWorkItemInput = Schema.Struct({
  providerId: Schema.String,
  itemId: Schema.String,
  projectId: Schema.optional(Schema.String),
  threadId: Schema.optional(Schema.String),
});
export type DispatchWorkItemInput = typeof DispatchWorkItemInput.Type;
export const WorkItemDispatchResult = Schema.Struct({
  accepted: Schema.Boolean,
  threadId: Schema.optional(Schema.String),
  runId: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
});
export type WorkItemDispatchResult = typeof WorkItemDispatchResult.Type;

export const WorkSourceStatus = Schema.Struct({
  state: Schema.Literals(["connected", "disconnected", "auth-required", "error"]),
  message: Schema.optional(Schema.String),
});
export type WorkSourceStatus = typeof WorkSourceStatus.Type;
