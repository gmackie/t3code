import "../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import SidebarFilesPanel from "./SidebarFilesPanel";

describe("SidebarFilesPanel", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("renders a collapsible workspace tree and opens files", async () => {
    const onSelectFile = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);

    const screen = await render(
      <SidebarFilesPanel
        entries={[
          { path: "README.md", kind: "file" },
          { path: "src", kind: "directory" },
          { path: "src/App.tsx", kind: "file", parentPath: "src" },
        ]}
        isLoading={false}
        isFetching={false}
        truncated={false}
        hideDotfiles
        selectedRelativePath={null}
        theme="dark"
        onHideDotfilesChange={() => undefined}
        onSelectFile={onSelectFile}
      />,
      { container: host },
    );

    try {
      await expect.element(page.getByLabelText("Expand src directory")).toBeInTheDocument();
      await page.getByLabelText("Expand src directory").click();
      await expect.element(page.getByLabelText("Open App.tsx")).toBeInTheDocument();

      await page.getByLabelText("Open App.tsx").click();

      expect(onSelectFile).toHaveBeenCalledWith("src/App.tsx");
    } finally {
      await screen.unmount();
      host.remove();
    }
  });
});
