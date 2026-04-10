import "../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import WorkspaceViewTabs from "./WorkspaceViewTabs";

describe("WorkspaceViewTabs", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("shows document symbols for the active TypeScript file and forwards the selection", async () => {
    const onSelectSymbol = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);

    const symbols = [
      {
        name: "Greeting",
        kind: "interface" as const,
        range: {
          start: { line: 1, column: 1 },
          end: { line: 3, column: 2 },
        },
        selectionRange: {
          start: { line: 1, column: 18 },
          end: { line: 1, column: 26 },
        },
      },
      {
        name: "sayHello",
        kind: "function" as const,
        range: {
          start: { line: 5, column: 1 },
          end: { line: 7, column: 2 },
        },
        selectionRange: {
          start: { line: 5, column: 17 },
          end: { line: 5, column: 25 },
        },
      },
    ];

    const screen = await render(
      <WorkspaceViewTabs
        tabs={[
          {
            id: "/repo/project:src/index.ts",
            cwd: "/repo/project",
            relativePath: "src/index.ts",
            line: null,
            column: null,
          },
        ]}
        activeTabId="/repo/project:src/index.ts"
        codeIntelligenceSource="typescript"
        documentSymbols={symbols}
        theme="dark"
        wordWrap={false}
        activeFileOpen
        onSelectTab={() => undefined}
        onCloseTab={() => undefined}
        onSelectSymbol={onSelectSymbol}
        onWordWrapChange={() => undefined}
      />,
      { container: host },
    );

    try {
      await expect
        .element(page.getByRole("button", { name: "Show document symbols" }))
        .toBeInTheDocument();

      await page.getByRole("button", { name: "Show document symbols" }).click();
      await expect.element(page.getByRole("menuitem", { name: "Greeting" })).toBeInTheDocument();
      await expect.element(page.getByRole("menuitem", { name: "sayHello" })).toBeInTheDocument();

      await page.getByRole("menuitem", { name: "sayHello" }).click();

      expect(onSelectSymbol).toHaveBeenCalledWith(symbols[1]);
    } finally {
      await screen.unmount();
      host.remove();
    }
  });
});
