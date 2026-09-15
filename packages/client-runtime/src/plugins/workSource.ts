import type {
  CreateWorkItemInput,
  DispatchWorkItemInput,
  WorkItemDispatchResult,
  WorkItem,
  WorkItemDetail,
  WorkItemScope,
  WorkItemStatus,
  WorkSourceCapability,
  WorkSourceStatus,
  UpdateWorkItemStatusInput,
} from "@t3tools/contracts";

export type WorkSourceProvider = {
  id: string;
  displayName: string;
  capabilities: readonly WorkSourceCapability[];
  getStatus(): Promise<WorkSourceStatus>;
  list(scope: WorkItemScope): Promise<readonly WorkItem[]>;
  get(itemId: string): Promise<WorkItemDetail>;
  listStatuses?(scope: WorkItemScope): Promise<readonly WorkItemStatus[]>;
  updateStatus?(input: UpdateWorkItemStatusInput): Promise<WorkItem>;
  create?(input: CreateWorkItemInput): Promise<WorkItem>;
  dispatch?(input: DispatchWorkItemInput): Promise<WorkItemDispatchResult>;
};

export const makeWorkSourceProvider = (provider: WorkSourceProvider): WorkSourceProvider =>
  provider;
