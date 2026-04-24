import "../../index.css";

import { EnvironmentId } from "@t3tools/contracts";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ProposedPlanCard } from "./ProposedPlanCard";

describe("ProposedPlanCard", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("opens linked workspace files in the in-app viewer when the plan includes a file link", async () => {
    const handleOpenWorkspaceFile = vi.fn();
    const screen = await render(
      <ProposedPlanCard
        planMarkdown={`See [ChatView.tsx](file:///repo/project/src/components/ChatView.tsx#L2C5)`}
        environmentId={EnvironmentId.make("environment-local")}
        cwd="/repo/project"
        workspaceRoot="/repo/project"
        onOpenWorkspaceFile={handleOpenWorkspaceFile}
      />,
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
    } finally {
      await screen.unmount();
    }
  });
});
