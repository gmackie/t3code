import type {
  EnvironmentId,
  OrchestrationMessage,
  OrchestrationReadModel,
  OrchestrationSessionStatus,
  ThreadId,
} from "@t3tools/contracts";
import { create } from "zustand";

export interface MobileThreadSummary {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly title: string;
  readonly updatedAt: string;
  readonly sessionStatus: OrchestrationSessionStatus | "unknown";
  readonly hasPendingApprovals: boolean;
  readonly hasPendingUserInput: boolean;
  readonly hasActionableProposedPlan: boolean;
  readonly latestUserMessageAt: string | null;
}

export interface MobileThreadDetail extends MobileThreadSummary {
  readonly messages: ReadonlyArray<OrchestrationMessage>;
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

export function reduceRuntimeSnapshot(
  state: Omit<ThreadStoreState, "applySnapshot" | "setEnvironmentConnectionState" | "reset">,
  input: {
    readonly environmentId: EnvironmentId;
    readonly snapshot: OrchestrationReadModel;
  },
): Omit<ThreadStoreState, "applySnapshot" | "setEnvironmentConnectionState" | "reset"> {
  const nextSummaryByKey = { ...state.threadSummaryByKey };
  const nextDetailByKey = { ...state.threadDetailByKey };

  for (const thread of input.snapshot.threads) {
    const key = threadStoreKey(input.environmentId, thread.id);
    const summary: MobileThreadSummary = {
      environmentId: input.environmentId,
      threadId: thread.id,
      title: thread.title,
      updatedAt: thread.updatedAt,
      sessionStatus: thread.session?.status ?? "unknown",
      hasPendingApprovals: thread.activities.some((activity) => activity.tone === "approval"),
      hasPendingUserInput:
        thread.session?.status === "interrupted" &&
        thread.activities.some((activity) => activity.tone === "tool"),
      hasActionableProposedPlan: thread.proposedPlans.some((plan) => plan.implementedAt === null),
      latestUserMessageAt:
        thread.messages.toReversed().find((message) => message.role === "user")?.createdAt ?? null,
    };

    nextSummaryByKey[key] = summary;
    nextDetailByKey[key] = {
      ...summary,
      messages: thread.messages,
    };
  }

  const nextInbox = Object.values(nextSummaryByKey)
    .filter((thread) => thread.environmentId === input.environmentId)
    .flatMap((thread) => inboxItemsForThread(thread))
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  return {
    ...state,
    threadSummaryByKey: nextSummaryByKey,
    threadDetailByKey: nextDetailByKey,
    inbox: [
      ...nextInbox,
      ...state.inbox.filter((item) => item.environmentId !== input.environmentId),
    ].toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    connectionStateByEnvironment: {
      ...state.connectionStateByEnvironment,
      [input.environmentId]: "ready",
    },
  };
}

const initialState = {
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
  return Object.values(useThreadStore.getState().threadSummaryByKey).toSorted((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
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
