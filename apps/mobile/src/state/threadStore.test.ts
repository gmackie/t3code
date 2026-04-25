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
                provider: "codex",
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
});
