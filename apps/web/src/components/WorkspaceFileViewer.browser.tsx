import "../index.css";

import type { NativeApi } from "@t3tools/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import WorkspaceFileViewer from "./WorkspaceFileViewer";

function mockNativeApi(input: { contents: string; relativePath?: string }) {
  const readFile = vi.fn().mockResolvedValue({
    relativePath: input.relativePath ?? "src/example.ts",
    contents: input.contents,
  });
  const getHover = vi.fn().mockResolvedValue({
    source: "typescript",
    hover: {
      contents: "function sayHello(name: string): string",
      range: {
        start: { line: 1, column: 17 },
        end: { line: 1, column: 25 },
      },
    },
  });
  const getDefinitions = vi.fn().mockResolvedValue({
    source: "typescript",
    definitions: [],
  });

  window.nativeApi = {
    projects: {
      getDefinitions,
      getHover,
      readFile,
    },
  } as unknown as NativeApi;

  return { getDefinitions, getHover, readFile };
}

async function mountViewer(options?: {
  line?: number | null;
  column?: number | null;
  wordWrap?: boolean;
}) {
  const host = document.createElement("div");
  document.body.append(host);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <WorkspaceFileViewer
        cwd="/repo/project"
        relativePath="src/example.ts"
        line={options?.line ?? null}
        column={options?.column ?? null}
        theme="dark"
        wordWrap={options?.wordWrap ?? false}
      />
    </QueryClientProvider>,
    { container: host },
  );

  const cleanup = async () => {
    queryClient.clear();
    await screen.unmount();
    host.remove();
  };

  return {
    [Symbol.asyncDispose]: cleanup,
    cleanup,
  };
}

describe("WorkspaceFileViewer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete window.nativeApi;
    document.body.innerHTML = "";
  });

  it("renders highlighted code with a line-number gutter for source files", async () => {
    const { readFile } = mockNativeApi({
      contents: [
        'import { describe, expect, it } from "vitest";',
        "",
        'const value = "hello";',
        "console.log(value);",
      ].join("\n"),
    });

    await using _ = await mountViewer();

    await vi.waitFor(() => {
      expect(readFile).toHaveBeenCalledWith({
        cwd: "/repo/project",
        relativePath: "src/example.ts",
      });
    });

    await vi.waitFor(() => {
      const lineNumbers = document.querySelector<HTMLElement>(
        '[data-testid="workspace-file-viewer-line-numbers"]',
      );
      expect(lineNumbers).not.toBeNull();
      expect(lineNumbers?.textContent ?? "").toMatch(/1[\s\S]*2[\s\S]*3[\s\S]*4/);

      const highlightedCode = document.querySelector(
        '[data-testid="workspace-file-viewer-code-line"]',
      );
      expect(highlightedCode).not.toBeNull();

      const codeLines = Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid="workspace-file-viewer-code-line"]'),
      );
      const gutterLines = Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid="workspace-file-viewer-line-number"]'),
      );
      expect(codeLines.length).toBeGreaterThanOrEqual(4);
      expect(gutterLines.length).toBe(4);

      const codeLineDelta = Math.round(
        codeLines[1]!.getBoundingClientRect().top - codeLines[0]!.getBoundingClientRect().top,
      );
      const gutterLineDelta = Math.round(
        gutterLines[1]!.getBoundingClientRect().top - gutterLines[0]!.getBoundingClientRect().top,
      );
      expect(Math.abs(codeLineDelta - gutterLineDelta)).toBeLessThanOrEqual(2);
    });
  });

  it("highlights hovered and selected lines", async () => {
    mockNativeApi({
      contents: ["firstLine();", "secondLine();", "thirdLine();"].join("\n"),
    });

    await using _ = await mountViewer();

    await vi.waitFor(() => {
      const firstCodeRow = document.querySelector<HTMLElement>(
        '[data-testid="workspace-file-viewer-code-row"]',
      );
      expect(firstCodeRow).not.toBeNull();
    });

    const secondCodeRow = page.getByTestId("workspace-file-viewer-code-row").nth(1);
    await secondCodeRow.hover();

    await vi.waitFor(() => {
      const hoveredCodeRow = document.querySelector<HTMLElement>(
        '[data-testid="workspace-file-viewer-code-row"][data-line-number="2"]',
      );
      expect(hoveredCodeRow).not.toBeNull();
      expect(hoveredCodeRow?.dataset.selected).toBe("false");
      expect(getComputedStyle(hoveredCodeRow!).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    });

    await secondCodeRow.click();

    await vi.waitFor(() => {
      const selectedCodeRow = document.querySelector<HTMLElement>(
        '[data-testid="workspace-file-viewer-code-row"][data-line-number="2"]',
      );
      expect(selectedCodeRow?.dataset.selected).toBe("true");
    });
  });

  it("scrolls the requested line into view when opened with a line target", async () => {
    const scrollIntoViewSpy = vi
      .spyOn(Element.prototype, "scrollIntoView")
      .mockImplementation(() => undefined);

    mockNativeApi({
      contents: ["firstLine();", "secondLine();", "thirdLine();", "fourthLine();"].join("\n"),
    });

    await using _ = await mountViewer({ line: 3 });

    await vi.waitFor(() => {
      const selectedCodeRow = document.querySelector<HTMLElement>(
        '[data-testid="workspace-file-viewer-code-row"][data-line-number="3"]',
      );
      expect(selectedCodeRow?.dataset.selected).toBe("true");
      expect(scrollIntoViewSpy).toHaveBeenCalled();
    });
  });

  it("renders wrapped code when word wrapping is enabled externally", async () => {
    mockNativeApi({
      relativePath: "src/long-line.ts",
      contents:
        'const longValue = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";',
    });

    await using _ = await mountViewer({ wordWrap: true });

    await vi.waitFor(() => {
      const firstCodeLine = document.querySelector<HTMLElement>(
        '[data-testid="workspace-file-viewer-code-line"]',
      );
      expect(firstCodeLine).not.toBeNull();
      expect(getComputedStyle(firstCodeLine!).whiteSpace).toBe("pre-wrap");
    });
  });

  it("renders TypeScript hover details for the active selection", async () => {
    const { getHover } = mockNativeApi({
      contents: "export function sayHello(name: string) { return name; }\n",
    });

    await using _ = await mountViewer({ line: 1, column: 17 });

    await vi.waitFor(() => {
      expect(getHover).toHaveBeenCalledWith({
        cwd: "/repo/project",
        relativePath: "src/example.ts",
        line: 1,
        column: 17,
      });
    });

    await expect
      .element(page.getByTestId("workspace-file-viewer-hover-card"))
      .toHaveTextContent("function sayHello(name: string): string");
  });
});
