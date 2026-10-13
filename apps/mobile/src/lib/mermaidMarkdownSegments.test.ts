import { describe, expect, it } from "vite-plus/test";
import { splitMermaidMarkdown } from "./mermaidMarkdownSegments";

describe("splitMermaidMarkdown", () => {
  it("keeps markdown without diagrams as one segment", () => {
    const markdown = "Hello\n\n```ts\nconst x = 1;\n```";
    expect(splitMermaidMarkdown(markdown)).toEqual([{ kind: "markdown", markdown }]);
  });

  it("splits prose around a mermaid fence", () => {
    expect(
      splitMermaidMarkdown("Before\n\n```Mermaid title\ngraph TD\nA-->B\n```\n\nAfter"),
    ).toEqual([
      { kind: "markdown", markdown: "Before\n" },
      {
        kind: "mermaid",
        source: "graph TD\nA-->B",
        fence: "```Mermaid title\ngraph TD\nA-->B\n```",
      },
      { kind: "markdown", markdown: "\nAfter" },
    ]);
  });

  it("supports tilde fences and requires a matching closing fence", () => {
    expect(splitMermaidMarkdown("~~~~mermaid\nA\n~~~\n```\nB\n~~~~")).toEqual([
      {
        kind: "mermaid",
        source: "A\n~~~\n```\nB",
        fence: "~~~~mermaid\nA\n~~~\n```\nB\n~~~~",
      },
    ]);
  });

  it("leaves mermaid examples inside other fences alone", () => {
    const markdown = "````md\n```mermaid\ngraph TD\n```\n````\n\n~~~\n```mermaid\n~~~";
    expect(splitMermaidMarkdown(markdown)).toEqual([{ kind: "markdown", markdown }]);
  });

  it("ignores indented code and nested list fences", () => {
    const markdown = "    ```mermaid\n    A\n    ```\n- ```mermaid\n  B\n  ```";
    expect(splitMermaidMarkdown(markdown)).toEqual([{ kind: "markdown", markdown }]);
  });

  it("treats an unclosed mermaid fence as running to the end while streaming", () => {
    expect(splitMermaidMarkdown("Intro\n```mermaid\ngraph TD\nA-")).toEqual([
      { kind: "markdown", markdown: "Intro" },
      { kind: "mermaid", source: "graph TD\nA-", fence: "```mermaid\ngraph TD\nA-" },
    ]);
  });

  it("does not open a backtick fence whose info string contains backticks", () => {
    const markdown = "```mermaid `x`\nA\n```";
    // Not an opening fence; the trailing ``` then opens an unclosed plain fence.
    expect(splitMermaidMarkdown(markdown)).toEqual([{ kind: "markdown", markdown }]);
  });
});
