import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { IssueItem, IssuePrepareThreadResult, IssueProviderKind, IssueReference } from "./issue.ts";

const decodeIssueProviderKind = Schema.decodeSync(IssueProviderKind);
const decodeIssueItem = Schema.decodeSync(IssueItem);
const decodeIssueReference = Schema.decodeSync(IssueReference);
const decodeIssuePrepareThreadResult = Schema.decodeSync(IssuePrepareThreadResult);

describe("issue contracts", () => {
  it("decodes provider kinds", () => {
    expect(decodeIssueProviderKind("linear")).toBe("linear");
  });

  it("decodes a minimal issue item", () => {
    const issue = decodeIssueItem({
      provider: "linear",
      id: "issue-id",
      key: "ENG-123",
      title: "Fix startup",
      url: "https://linear.app/acme/issue/ENG-123/fix-startup",
      state: "open",
      labels: [],
      comments: [],
    });

    expect(issue.key).toBe("ENG-123");
    expect(issue.comments.length).toBe(0);
  });

  it("decodes issue references and prepare results", () => {
    expect(decodeIssueReference("ENG-123")).toBe("ENG-123");
    const result = decodeIssuePrepareThreadResult({
      issue: {
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
      initialPrompt: "Issue context...",
    });

    expect(result.branch).toBe("linear/eng-123-fix-startup");
  });
});
