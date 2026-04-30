import type { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { reduceRuntimeSnapshot } from "./threadStore";

describe("threadStore", () => {
  it("promotes blocked approvals into the inbox", () => {
    const state = reduceRuntimeSnapshot(
      {
        threadSummaryByKey: {},
        threadDetailByKey: {},
        inbox: [],
        connectionStateByEnvironment: {},
      },
      {
        environmentId: "env_mobile_test" as EnvironmentId,
        snapshot: {
          snapshotSequence: 1,
          updatedAt: "2026-04-24T20:00:00Z",
          projects: [],
          threads: [
            {
              id: "thread-1" as never,
              projectId: "project-1" as never,
              title: "Fix auth issue",
              modelSelection: {
                instanceId: "codex" as never,
                model: "gpt-5.4",
              },
              runtimeMode: "approval-required",
              interactionMode: "default",
              branch: null,
              worktreePath: null,
              latestTurn: null,
              createdAt: "2026-04-24T20:00:00Z",
              updatedAt: "2026-04-24T20:00:00Z",
              archivedAt: null,
              deletedAt: null,
              messages: [],
              proposedPlans: [],
              checkpoints: [],
              activities: [
                {
                  id: "evt-1" as never,
                  tone: "approval",
                  kind: "approval",
                  summary: "Apply this patch?",
                  payload: {},
                  turnId: null,
                  createdAt: "2026-04-24T20:00:00Z",
                },
              ],
              session: {
                threadId: "thread-1" as never,
                status: "running",
                providerName: "codex",
                runtimeMode: "approval-required",
                activeTurnId: null,
                lastError: null,
                updatedAt: "2026-04-24T20:00:00Z",
              },
            },
          ],
        },
      },
    );

    expect(state.inbox[0]?.threadId).toBe("thread-1");
    expect(state.inbox[0]?.kind).toBe("approval");
  });

  it("reduces snapshots without requiring Hermes-missing array copy methods", () => {
    const toSortedDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "toSorted");
    const toReversedDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "toReversed");
    Reflect.deleteProperty(Array.prototype, "toSorted");
    Reflect.deleteProperty(Array.prototype, "toReversed");

    try {
      const state = reduceRuntimeSnapshot(
        {
          threadSummaryByKey: {},
          threadDetailByKey: {},
          inbox: [],
          connectionStateByEnvironment: {},
        },
        {
          environmentId: "env_mobile_test" as EnvironmentId,
          snapshot: {
            snapshotSequence: 1,
            updatedAt: "2026-04-24T20:00:00Z",
            projects: [],
            threads: [
              {
                id: "thread-1" as never,
                projectId: "project-1" as never,
                title: "Fix auth issue",
                modelSelection: {
                  instanceId: "codex" as never,
                  model: "gpt-5.4",
                },
                runtimeMode: "approval-required",
                interactionMode: "default",
                branch: null,
                worktreePath: null,
                latestTurn: null,
                createdAt: "2026-04-24T20:00:00Z",
                updatedAt: "2026-04-24T20:00:00Z",
                archivedAt: null,
                deletedAt: null,
                messages: [
                  {
                    id: "message-1" as never,
                    role: "user",
                    text: "first",
                    streaming: false,
                    createdAt: "2026-04-24T19:00:00Z",
                    updatedAt: "2026-04-24T19:00:00Z",
                    turnId: null,
                  },
                  {
                    id: "message-2" as never,
                    role: "assistant",
                    text: "second",
                    streaming: false,
                    createdAt: "2026-04-24T19:01:00Z",
                    updatedAt: "2026-04-24T19:01:00Z",
                    turnId: null,
                  },
                  {
                    id: "message-3" as never,
                    role: "user",
                    text: "latest",
                    streaming: false,
                    createdAt: "2026-04-24T20:00:00Z",
                    updatedAt: "2026-04-24T20:00:00Z",
                    turnId: null,
                  },
                ],
                proposedPlans: [],
                checkpoints: [],
                activities: [],
                session: {
                  threadId: "thread-1" as never,
                  status: "running",
                  providerName: "codex",
                  runtimeMode: "approval-required",
                  activeTurnId: null,
                  lastError: null,
                  updatedAt: "2026-04-24T20:00:00Z",
                },
              },
            ],
          },
        },
      );

      expect(state.threadSummaryByKey["env_mobile_test:thread-1"]?.latestUserMessageAt).toBe(
        "2026-04-24T20:00:00Z",
      );
    } finally {
      if (toSortedDescriptor) {
        // eslint-disable-next-line no-extend-native -- Test restores the simulated Hermes runtime gap.
        Object.defineProperty(Array.prototype, "toSorted", toSortedDescriptor);
      }
      if (toReversedDescriptor) {
        // eslint-disable-next-line no-extend-native -- Test restores the simulated Hermes runtime gap.
        Object.defineProperty(Array.prototype, "toReversed", toReversedDescriptor);
      }
    }
  });

  it("keeps the thread git cwd on detail records for mobile PR actions", () => {
    const state = reduceRuntimeSnapshot(
      {
        threadSummaryByKey: {},
        threadDetailByKey: {},
        inbox: [],
        connectionStateByEnvironment: {},
      },
      {
        environmentId: "env_mobile_test" as EnvironmentId,
        snapshot: {
          snapshotSequence: 1,
          updatedAt: "2026-04-24T20:00:00Z",
          projects: [
            {
              id: "project-1" as never,
              title: "T3 Code",
              workspaceRoot: "/repo/t3code",
              defaultModelSelection: null,
              scripts: [],
              createdAt: "2026-04-24T20:00:00Z",
              updatedAt: "2026-04-24T20:00:00Z",
              deletedAt: null,
            },
          ],
          threads: [
            {
              id: "thread-1" as never,
              projectId: "project-1" as never,
              title: "Fix mobile controls",
              modelSelection: {
                instanceId: "codex" as never,
                model: "gpt-5.4",
              },
              runtimeMode: "approval-required",
              interactionMode: "default",
              branch: "t3code/mobile-controls",
              worktreePath: "/repo/worktrees/t3code/mobile-controls",
              latestTurn: null,
              createdAt: "2026-04-24T20:00:00Z",
              updatedAt: "2026-04-24T20:00:00Z",
              archivedAt: null,
              deletedAt: null,
              messages: [],
              proposedPlans: [],
              checkpoints: [],
              activities: [],
              session: null,
            },
          ],
        },
      },
    );

    expect(state.threadDetailByKey["env_mobile_test:thread-1"]).toMatchObject({
      branch: "t3code/mobile-controls",
      projectCwd: "/repo/worktrees/t3code/mobile-controls",
    });
  });
});
