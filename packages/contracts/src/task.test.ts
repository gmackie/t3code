import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { TaskItem, TaskPrepareThreadResult, TaskProviderKind, TaskReference } from "./task.ts";

const decodeTaskProviderKind = Schema.decodeSync(TaskProviderKind);
const decodeTaskItem = Schema.decodeSync(TaskItem);
const decodeTaskReference = Schema.decodeSync(TaskReference);
const decodeTaskPrepareThreadResult = Schema.decodeSync(TaskPrepareThreadResult);

describe("task contracts", () => {
  it("decodes provider kinds", () => {
    expect(decodeTaskProviderKind("linear")).toBe("linear");
  });

  it("decodes a minimal task item", () => {
    const task = decodeTaskItem({
      provider: "linear",
      id: "issue-id",
      key: "ENG-123",
      title: "Fix startup",
      url: "https://linear.app/acme/issue/ENG-123/fix-startup",
      state: "open",
      labels: [],
      comments: [],
    });

    expect(task.key).toBe("ENG-123");
    expect(task.comments.length).toBe(0);
  });

  it("decodes task references and prepare results", () => {
    expect(decodeTaskReference("ENG-123")).toBe("ENG-123");
    const result = decodeTaskPrepareThreadResult({
      task: {
        provider: "linear",
        id: "issue-id",
        key: "ENG-123",
        title: "Fix startup",
        url: "https://linear.app/acme/issue/ENG-123/fix-startup",
        state: "open",
        labels: [],
        comments: [],
      },
      branch: "linear/eng-123-fix-startup",
      worktreePath: null,
      initialPrompt: "Task context...",
    });

    expect(result.branch).toBe("linear/eng-123-fix-startup");
  });
});
