import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  IssueItem,
  IssueLifecycleUpdateInput,
  IssuePrepareThreadResult,
  IssueProjectAssociation,
  IssueProviderKind,
  IssueReference,
} from "./issue.ts";

const decodeIssueProviderKind = Schema.decodeSync(IssueProviderKind);
const decodeIssueItem = Schema.decodeSync(IssueItem);
const decodeIssueReference = Schema.decodeSync(IssueReference);
const decodeIssuePrepareThreadResult = Schema.decodeSync(IssuePrepareThreadResult);
const decodeIssueProjectAssociation = Schema.decodeSync(IssueProjectAssociation);
const decodeIssueLifecycleUpdateInput = Schema.decodeSync(IssueLifecycleUpdateInput);

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

  it("decodes project association metadata for Linear and GitHub Issues", () => {
    const linear = decodeIssueProjectAssociation({
      provider: "linear",
      projectId: "project-1",
      repositoryKey: "github:pingdotgg/t3code",
      linear: {
        projectId: "lin-project-id",
        projectName: "T3 Code",
        teamKey: "ENG",
      },
    });
    const github = decodeIssueProjectAssociation({
      provider: "github-issues",
      projectId: "project-1",
      repositoryKey: "github:pingdotgg/t3code",
      github: {
        repository: "pingdotgg/t3code",
      },
    });

    expect(linear.linear?.projectId).toBe("lin-project-id");
    expect(github.github?.repository).toBe("pingdotgg/t3code");
  });

  it("decodes lifecycle updates from change request events", () => {
    const update = decodeIssueLifecycleUpdateInput({
      provider: "linear",
      reference: "ENG-123",
      cwd: "/repo",
      event: "change_request_opened",
      changeRequest: {
        provider: "github",
        number: 123,
        title: "Fix startup",
        url: "https://github.com/pingdotgg/t3code/pull/123",
        state: "open",
      },
    });

    expect(update.event).toBe("change_request_opened");
    expect(update.changeRequest?.number).toBe(123);
  });
});
