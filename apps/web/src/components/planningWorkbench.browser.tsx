import "../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const { openInPreferredEditorMock, readLocalApiMock } = vi.hoisted(() => ({
  openInPreferredEditorMock: vi.fn(async () => "vscode"),
  readLocalApiMock: vi.fn(() => ({
    server: { getConfig: vi.fn(async () => ({ availableEditors: ["vscode"] })) },
    shell: { openInEditor: vi.fn(async () => undefined) },
  })),
}));

vi.mock("../editorPreferences", () => ({
  openInPreferredEditor: openInPreferredEditorMock,
}));

vi.mock("../localApi", () => ({
  ensureLocalApi: vi.fn(() => {
    throw new Error("ensureLocalApi not implemented in browser test");
  }),
  readLocalApi: readLocalApiMock,
}));

import { planningWorkbenchExtension } from "../extensions/builtins/planningWorkbench";

describe("planningWorkbenchExtension", () => {
  afterEach(() => {
    openInPreferredEditorMock.mockClear();
    readLocalApiMock.mockClear();
    document.body.innerHTML = "";
  });

  it("opens workspace files in the in-app viewer when plan markdown contains a file link", async () => {
    const handleOpenWorkspaceFile = vi.fn();
    const screen = await render(
      planningWorkbenchExtension.render({
        activeThreadId: "thread-1" as any,
        threadView: {
          thread: {
            id: "thread-1" as any,
            projectId: "project-1" as any,
            title: "Planning",
            model: "gpt-5",
            runtimeMode: "full-access" as any,
            interactionMode: "default" as any,
            branch: null,
            worktreePath: null,
            createdAt: "2026-04-19T00:00:00.000Z",
            latestTurn: null,
          },
          project: {
            id: "project-1" as any,
            name: "Project",
            cwd: "/repo/project",
            model: "gpt-5",
            scripts: [],
          },
          activePlan: null,
          latestProposedPlan: {
            id: "plan-1" as any,
            createdAt: "2026-04-19T00:00:00.000Z",
            updatedAt: "2026-04-19T00:00:00.000Z",
            turnId: null,
            planMarkdown:
              "Open [ChatView.tsx](file:///repo/project/src/components/ChatView.tsx#L2C5)",
            implementedAt: null,
            implementationThreadId: null,
          },
          pendingApprovals: [],
          pendingUserInputs: [],
          workLog: [],
          latestTurnId: null,
        },
        onOpenWorkspaceFile: handleOpenWorkspaceFile,
      } as any),
    );

    try {
      const link = page.getByRole("link", { name: "ChatView.tsx · L2:C5" });
      await expect.element(link).toBeInTheDocument();

      await link.click();

      await vi.waitFor(() => {
        expect(handleOpenWorkspaceFile).toHaveBeenCalledWith({
          cwd: "/repo/project",
          relativePath: "src/components/ChatView.tsx",
          line: 2,
          column: 5,
          targetPath: "/repo/project/src/components/ChatView.tsx:2:5",
        });
      });
      expect(openInPreferredEditorMock).not.toHaveBeenCalled();
    } finally {
      await screen.unmount();
    }
  });
});
