import { describe, expect, it } from "vitest";

import { buildPlanningRequirementsMarkdown, buildPlanningTaskDrafts } from "./logic";

describe("planningWorkbench logic", () => {
  it("builds requirements markdown from a proposed plan", () => {
    const planMarkdown = `# Experimental extension host

## Summary
Add a minimal extension host for planning and previews.

- Add an extension registry
- Add a side panel host
1. Keep provider internals untouched
`;

    expect(buildPlanningRequirementsMarkdown(planMarkdown)).toBe(`# Requirements

## Goal
Experimental extension host

## Functional Requirements
- Add an extension registry
- Add a side panel host
- Keep provider internals untouched
`);
  });

  it("ignores list items inside fenced code blocks", () => {
    const planMarkdown = `# Build the thing

- Real requirement

\`\`\`markdown
- This is an example, not a requirement
- Another example
\`\`\`

1. Another real requirement
`;

    expect(buildPlanningTaskDrafts(planMarkdown)).toEqual([
      { id: "task-1", title: "Real requirement" },
      { id: "task-2", title: "Another real requirement" },
    ]);
  });

  it("ignores list items inside tilde code blocks", () => {
    const planMarkdown = `# Plan

- Keep this

~~~typescript
- Remove this
~~~
`;

    expect(buildPlanningTaskDrafts(planMarkdown)).toEqual([
      { id: "task-1", title: "Keep this" },
    ]);
  });

  it("returns fallback requirements for an empty plan", () => {
    const result = buildPlanningRequirementsMarkdown("");
    expect(result).toContain("- Review and refine the proposed plan");
  });

  it("returns empty task drafts for an empty plan", () => {
    expect(buildPlanningTaskDrafts("")).toEqual([]);
  });

  it("returns empty task drafts for a plan with only code fences", () => {
    const planMarkdown = `# Plan

\`\`\`
- Only in code
\`\`\`
`;

    expect(buildPlanningTaskDrafts(planMarkdown)).toEqual([]);
  });

  it("handles unclosed code fences (truncated streaming plan)", () => {
    const planMarkdown = `# Plan

- Real item

\`\`\`
- Inside unclosed fence
- Also inside`;

    expect(buildPlanningTaskDrafts(planMarkdown)).toEqual([
      { id: "task-1", title: "Real item" },
    ]);
  });

  it("handles closing fence with more backticks than opener", () => {
    const planMarkdown = `# Plan

- Keep this

\`\`\`
- Remove this
\`\`\`\`

- Also keep this
`;

    expect(buildPlanningTaskDrafts(planMarkdown)).toEqual([
      { id: "task-1", title: "Keep this" },
      { id: "task-2", title: "Also keep this" },
    ]);
  });

  it("deduplicates repeated list items", () => {
    const planMarkdown = `# Plan

- Same item
- Different item
- Same item
`;

    expect(buildPlanningTaskDrafts(planMarkdown)).toEqual([
      { id: "task-1", title: "Same item" },
      { id: "task-2", title: "Different item" },
    ]);
  });

  it("uses plan title as goal in requirements markdown", () => {
    const planMarkdown = `# My Custom Title

- First requirement
`;

    const result = buildPlanningRequirementsMarkdown(planMarkdown);
    expect(result).toContain("## Goal\nMy Custom Title");
  });

  it("uses fallback goal when plan has no heading", () => {
    const planMarkdown = `- Just a list item without a heading`;

    const result = buildPlanningRequirementsMarkdown(planMarkdown);
    expect(result).toContain("## Goal\nPlanning workbench artifact");
  });

  it("builds ordered task drafts from list items in a proposed plan", () => {
    const planMarkdown = `# Experimental extension host

- Add an extension registry
- Add a side panel host
1. Keep provider internals untouched
`;

    expect(buildPlanningTaskDrafts(planMarkdown)).toEqual([
      { id: "task-1", title: "Add an extension registry" },
      { id: "task-2", title: "Add a side panel host" },
      { id: "task-3", title: "Keep provider internals untouched" },
    ]);
  });
});
