import type {
  EnvironmentId,
  OrchestrationMessage,
  OrchestrationReadModel,
  OrchestrationSessionStatus,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { create } from "zustand";

import { findLastCompat, sortCopy } from "../lib/arrayCompat";

export interface MobileProjectSummary {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly workspaceRoot: string;
  readonly updatedAt: string;
  readonly threadCount: number;
  readonly activeThreadCount: number;
}

export interface MobileThreadSummary {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
  readonly title: string;
  readonly branch: string | null;
  readonly projectCwd: string | null;
  readonly updatedAt: string;
  readonly sessionStatus: OrchestrationSessionStatus | "unknown";
  readonly hasPendingApprovals: boolean;
  readonly hasPendingUserInput: boolean;
  readonly hasActionableProposedPlan: boolean;
  readonly latestUserMessageAt: string | null;
}

export interface MobileThreadDetail extends MobileThreadSummary {
  readonly messages: ReadonlyArray<OrchestrationMessage>;
  readonly changedFiles: ReadonlyArray<{
    readonly path: string;
    readonly summary: string;
  }>;
  readonly pendingApproval: {
    readonly requestId: string;
    readonly summary: string | null;
  } | null;
}

export interface MobileInboxItem {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly kind: "approval" | "user-input" | "plan";
  readonly updatedAt: string;
}

function inboxItemsForThread(thread: MobileThreadSummary): ReadonlyArray<MobileInboxItem> {
  if (thread.hasPendingApprovals) {
    return [
      {
        environmentId: thread.environmentId,
        threadId: thread.threadId,
        kind: "approval",
        updatedAt: thread.updatedAt,
      },
    ];
  }

  if (thread.hasPendingUserInput) {
    return [
      {
        environmentId: thread.environmentId,
        threadId: thread.threadId,
        kind: "user-input",
        updatedAt: thread.updatedAt,
      },
    ];
  }

  if (thread.hasActionableProposedPlan) {
    return [
      {
        environmentId: thread.environmentId,
        threadId: thread.threadId,
        kind: "plan",
        updatedAt: thread.updatedAt,
      },
    ];
  }

  return [];
}

export interface ThreadStoreState {
  readonly projectSummaryByKey: Record<string, MobileProjectSummary>;
  readonly threadSummaryByKey: Record<string, MobileThreadSummary>;
  readonly threadDetailByKey: Record<string, MobileThreadDetail>;
  readonly inbox: ReadonlyArray<MobileInboxItem>;
  readonly connectionStateByEnvironment: Record<
    EnvironmentId,
    "idle" | "syncing" | "ready" | "error"
  >;
  readonly applySnapshot: (environmentId: EnvironmentId, snapshot: OrchestrationReadModel) => void;
  readonly setEnvironmentConnectionState: (
    environmentId: EnvironmentId,
    state: "idle" | "syncing" | "ready" | "error",
  ) => void;
  readonly reset: () => void;
}

export function threadStoreKey(environmentId: EnvironmentId, threadId: ThreadId): string {
  return `${environmentId}:${threadId}`;
}

export function projectStoreKey(environmentId: EnvironmentId, projectId: ProjectId): string {
  return `${environmentId}:${projectId}`;
}

function readStringField(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null || !(key in value)) {
    return null;
  }

  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.trim() ? field : null;
}

export function reduceRuntimeSnapshot(
  state: Omit<ThreadStoreState, "applySnapshot" | "setEnvironmentConnectionState" | "reset">,
  input: {
    readonly environmentId: EnvironmentId;
    readonly snapshot: OrchestrationReadModel;
  },
): Omit<ThreadStoreState, "applySnapshot" | "setEnvironmentConnectionState" | "reset"> {
  const nextSummaryByKey = { ...state.threadSummaryByKey };
  const nextDetailByKey = { ...state.threadDetailByKey };
  const nextProjectSummaryByKey = { ...state.projectSummaryByKey };
  const projectWorkspaceRootById = new Map(
    input.snapshot.projects.map((project) => [project.id, project.workspaceRoot] as const),
  );
  type SnapshotThread = (typeof input.snapshot.threads)[number];
  const threadsByProjectId = new Map(
    input.snapshot.projects.map((project) => [project.id, [] as SnapshotThread[]]),
  );

  for (const thread of input.snapshot.threads) {
    const threads = threadsByProjectId.get(thread.projectId);
    if (threads) {
      threads.push(thread);
    }
  }

  for (const project of input.snapshot.projects) {
    const projectThreads = threadsByProjectId.get(project.id) ?? [];
    nextProjectSummaryByKey[projectStoreKey(input.environmentId, project.id)] = {
      environmentId: input.environmentId,
      projectId: project.id,
      title: project.title,
      workspaceRoot: project.workspaceRoot,
      updatedAt: project.updatedAt,
      threadCount: projectThreads.length,
      activeThreadCount: projectThreads.filter((thread) => thread.deletedAt === null).length,
    };
  }

  for (const thread of input.snapshot.threads) {
    const key = threadStoreKey(input.environmentId, thread.id);
    const projectWorkspaceRoot = projectWorkspaceRootById.get(thread.projectId) ?? null;
    const summary: MobileThreadSummary = {
      environmentId: input.environmentId,
      projectId: thread.projectId,
      threadId: thread.id,
      title: thread.title,
      branch: thread.branch,
      projectCwd: thread.worktreePath ?? projectWorkspaceRoot,
      updatedAt: thread.updatedAt,
      sessionStatus: thread.session?.status ?? "unknown",
      hasPendingApprovals: thread.activities.some((activity) => activity.tone === "approval"),
      hasPendingUserInput:
        thread.session?.status === "interrupted" &&
        thread.activities.some((activity) => activity.tone === "tool"),
      hasActionableProposedPlan: thread.proposedPlans.some((plan) => plan.implementedAt === null),
      latestUserMessageAt:
        findLastCompat(thread.messages, (message) => message.role === "user")?.createdAt ?? null,
    };

    nextSummaryByKey[key] = summary;
    const pendingApprovalActivity =
      thread.activities.find((activity) => activity.tone === "approval") ?? null;
    const pendingApprovalRequestId = pendingApprovalActivity
      ? readStringField(pendingApprovalActivity.payload, "requestId")
      : null;
    nextDetailByKey[key] = {
      ...summary,
      changedFiles:
        thread.checkpoints.at(-1)?.files.map((file) => ({
          path: file.path,
          summary: `${file.additions}+ / ${file.deletions}-`,
        })) ?? [],
      messages: thread.messages,
      pendingApproval:
        pendingApprovalActivity && pendingApprovalRequestId
          ? {
              requestId: pendingApprovalRequestId,
              summary: pendingApprovalActivity.summary,
            }
          : null,
    };
  }

  const nextInbox = sortCopy(
    Object.values(nextSummaryByKey)
      .filter((thread) => thread.environmentId === input.environmentId)
      .flatMap((thread) => inboxItemsForThread(thread)),
    (left, right) => right.updatedAt.localeCompare(left.updatedAt),
  );

  return {
    ...state,
    projectSummaryByKey: nextProjectSummaryByKey,
    threadSummaryByKey: nextSummaryByKey,
    threadDetailByKey: nextDetailByKey,
    inbox: sortCopy(
      [...nextInbox, ...state.inbox.filter((item) => item.environmentId !== input.environmentId)],
      (left, right) => right.updatedAt.localeCompare(left.updatedAt),
    ),
    connectionStateByEnvironment: {
      ...state.connectionStateByEnvironment,
      [input.environmentId]: "ready",
    },
  };
}

const initialState = {
  projectSummaryByKey: {},
  threadSummaryByKey: {},
  threadDetailByKey: {},
  inbox: [],
  connectionStateByEnvironment: {},
} satisfies Omit<ThreadStoreState, "applySnapshot" | "setEnvironmentConnectionState" | "reset">;

export const useThreadStore = create<ThreadStoreState>()((set) => ({
  ...initialState,
  applySnapshot: (environmentId, snapshot) =>
    set((state) =>
      reduceRuntimeSnapshot(state, {
        environmentId,
        snapshot,
      }),
    ),
  setEnvironmentConnectionState: (environmentId, connectionState) =>
    set((state) => ({
      connectionStateByEnvironment: {
        ...state.connectionStateByEnvironment,
        [environmentId]: connectionState,
      },
    })),
  reset: () =>
    set({
      ...initialState,
    }),
}));

export function listThreadSummaries(): ReadonlyArray<MobileThreadSummary> {
  return listThreadSummariesFromState(useThreadStore.getState());
}

export function listThreadSummariesFromState(
  state: Pick<ThreadStoreState, "threadSummaryByKey">,
): ReadonlyArray<MobileThreadSummary> {
  return sortCopy(Object.values(state.threadSummaryByKey), (left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

export function listProjectSummariesFromState(
  state: Pick<ThreadStoreState, "projectSummaryByKey">,
  environmentId?: EnvironmentId,
): ReadonlyArray<MobileProjectSummary> {
  return sortCopy(
    Object.values(state.projectSummaryByKey).filter(
      (project) => !environmentId || project.environmentId === environmentId,
    ),
    (left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) || left.title.localeCompare(right.title),
  );
}

export function listProjectSummaries(
  environmentId?: EnvironmentId,
): ReadonlyArray<MobileProjectSummary> {
  return listProjectSummariesFromState(useThreadStore.getState(), environmentId);
}

export function getProjectSummary(
  environmentId: EnvironmentId,
  projectId: ProjectId,
): MobileProjectSummary | null {
  return (
    useThreadStore.getState().projectSummaryByKey[projectStoreKey(environmentId, projectId)] ?? null
  );
}

export function listThreadSummariesForProjectFromState(
  state: Pick<ThreadStoreState, "threadSummaryByKey">,
  environmentId: EnvironmentId,
  projectId: ProjectId,
): ReadonlyArray<MobileThreadSummary> {
  return sortCopy(
    Object.values(state.threadSummaryByKey).filter(
      (thread) => thread.environmentId === environmentId && thread.projectId === projectId,
    ),
    (left, right) => right.updatedAt.localeCompare(left.updatedAt),
  );
}

export function listThreadSummariesForProject(
  environmentId: EnvironmentId,
  projectId: ProjectId,
): ReadonlyArray<MobileThreadSummary> {
  return listThreadSummariesForProjectFromState(
    useThreadStore.getState(),
    environmentId,
    projectId,
  );
}

export function getThreadDetail(
  environmentId: EnvironmentId,
  threadId: ThreadId,
): MobileThreadDetail | null {
  return (
    useThreadStore.getState().threadDetailByKey[threadStoreKey(environmentId, threadId)] ?? null
  );
}

export function resetThreadStoreForTests(): void {
  useThreadStore.getState().reset();
}
