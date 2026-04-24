import {
  EnvironmentId,
  EventId,
  ProjectId,
  ThreadId,
  TurnId,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { selectPanelThreadView, type PanelSelectorState } from "./panelSelectors";
import {
  DEFAULT_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type Project,
  type Thread,
} from "../types";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: ProjectId.make("project-1"),
    environmentId: EnvironmentId.make("environment-local"),
    name: "Project",
    cwd: "/tmp/project",
    defaultModelSelection: null,
    scripts: [],
    ...overrides,
  };
}

function makeActivity(
  kind: string,
  payload: Record<string, unknown>,
  overrides: Partial<OrchestrationThreadActivity> = {},
): OrchestrationThreadActivity {
  return {
    id: EventId.make(`event-${kind}`),
    tone: "info",
    kind,
    summary: kind,
    payload,
    turnId: overrides.turnId ?? null,
    createdAt: overrides.createdAt ?? "2026-03-21T00:00:00.000Z",
    ...overrides,
  };
}

function makeThread(overrides: Partial<Thread> = {}): Thread {
  const turnId = TurnId.make("turn-1");
  return {
    id: ThreadId.make("thread-1"),
    environmentId: EnvironmentId.make("environment-local"),
    codexThreadId: null,
    projectId: ProjectId.make("project-1"),
    title: "Thread",
    modelSelection: { provider: "codex", model: "gpt-5-codex" },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    messages: [],
    turnDiffSummaries: [],
    activities: [
      makeActivity(
        "approval.requested",
        {
          requestId: "approval-1",
          requestKind: "command",
          detail: "Run bun lint",
        },
        { createdAt: "2026-03-21T00:01:00.000Z", turnId },
      ),
    ],
    proposedPlans: [
      {
        id: "plan-1",
        turnId,
        planMarkdown: "# Build extension host\n\n- Add registry\n- Add selectors",
        implementedAt: null,
        implementationThreadId: null,
        createdAt: "2026-03-21T00:02:00.000Z",
        updatedAt: "2026-03-21T00:02:00.000Z",
      },
    ],
    error: null,
    createdAt: "2026-03-21T00:00:00.000Z",
    archivedAt: null,
    latestTurn: {
      turnId,
      state: "completed",
      requestedAt: "2026-03-21T00:00:00.000Z",
      startedAt: "2026-03-21T00:00:05.000Z",
      completedAt: "2026-03-21T00:02:30.000Z",
      assistantMessageId: null,
    },
    branch: "feature/extensions",
    worktreePath: "/tmp/project",
    ...overrides,
  };
}

describe("selectPanelThreadView", () => {
  it("derives extension-safe thread state for the active thread", () => {
    const thread = makeThread();
    const state: PanelSelectorState = {
      projects: [makeProject()],
      threads: [thread],
      threadsHydrated: true,
    };

    const view = selectPanelThreadView(state, thread.id);

    expect(view?.thread.id).toBe(thread.id);
    expect(view?.project?.id).toBe(thread.projectId);
    expect(view?.latestProposedPlan?.id).toBe("plan-1");
    expect(view?.pendingApprovals).toEqual([
      {
        requestId: "approval-1",
        requestKind: "command",
        createdAt: "2026-03-21T00:01:00.000Z",
        detail: "Run bun lint",
      },
    ]);
    expect(view?.latestTurnId).toBe("turn-1");
  });
});
