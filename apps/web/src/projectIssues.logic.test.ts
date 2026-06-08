import { describe, expect, it } from "vite-plus/test";
import type { IssueItem, ProjectIssueStatus } from "@t3tools/contracts";

import {
  buildIssueThreadDraftPrompt,
  groupIssuesByStatus,
  resolveProjectIssueKeyBadgeClassName,
  resolveProjectIssueProviderBadgeClassName,
  resolveProjectIssueStatusBadgeClassName,
  resolveIssueStatusOptions,
  resolveSelectableIssueStatuses,
  shouldRenderCreateIssueModal,
} from "./projectIssues.logic";

function issue(overrides: Partial<IssueItem> & Pick<IssueItem, "id" | "key" | "title">): IssueItem {
  return {
    provider: "linear",
    url: `https://linear.app/acme/issue/${overrides.key}`,
    state: "open",
    labels: [],
    comments: [],
    ...overrides,
  };
}

describe("projectIssues logic", () => {
  const statuses: ProjectIssueStatus[] = [
    { id: "state-backlog", name: "Backlog", state: "open" },
    { id: "state-review", name: "In Review", state: "in_progress" },
    { id: "state-done", name: "Done", state: "done" },
  ];

  it("derives stable status options from issues", () => {
    expect(
      resolveIssueStatusOptions([
        issue({
          id: "issue-1",
          key: "ENG-1",
          title: "Backlog item",
          statusName: "Backlog",
        }),
        issue({
          id: "issue-2",
          key: "ENG-2",
          title: "Started item",
          state: "in_progress",
          statusName: "In Progress",
        }),
      ]),
    ).toEqual(["Backlog", "In Progress"]);
  });

  it("uses workflow statuses as selectable status options", () => {
    expect(
      resolveSelectableIssueStatuses({
        statuses,
        issues: [
          issue({
            id: "issue-1",
            key: "ENG-1",
            title: "Review item",
            state: "in_progress",
            statusId: "state-review",
            statusName: "In Review",
          }),
        ],
      }),
    ).toEqual(statuses);
  });

  it("includes an issue status fallback when it is absent from the workflow list", () => {
    expect(
      resolveSelectableIssueStatuses({
        statuses,
        issues: [
          issue({
            id: "issue-1",
            key: "ENG-1",
            title: "Blocked item",
            state: "unknown",
            statusId: "state-blocked",
            statusName: "Blocked",
          }),
        ],
      }).map((status) => status.name),
    ).toEqual(["Backlog", "In Review", "Done", "Blocked"]);
  });

  it("falls back to issue-derived statuses when workflow statuses are unavailable", () => {
    expect(
      resolveSelectableIssueStatuses({
        statuses: [],
        issues: [
          issue({
            id: "issue-1",
            key: "ENG-1",
            title: "Started item",
            state: "in_progress",
            statusId: "state-started",
            statusName: "In Progress",
          }),
        ],
      }),
    ).toEqual([{ id: "state-started", name: "In Progress", state: "in_progress" }]);
  });

  it("keeps Backlog available when neither workflow statuses nor issues are loaded", () => {
    expect(resolveSelectableIssueStatuses({ statuses: [], issues: [] })).toEqual([
      { id: "Backlog", name: "Backlog", state: "open" },
    ]);
  });

  it("groups issues by display status for kanban columns", () => {
    const grouped = groupIssuesByStatus([
      issue({ id: "issue-1", key: "ENG-1", title: "First", statusName: "Backlog" }),
      issue({
        id: "issue-2",
        key: "ENG-2",
        title: "Second",
        state: "in_progress",
        statusName: "In Progress",
      }),
      issue({ id: "issue-3", key: "ENG-3", title: "Third", statusName: "Backlog" }),
    ]);

    expect(grouped.map((group) => ({ label: group.label, count: group.issues.length }))).toEqual([
      { label: "Backlog", count: 2 },
      { label: "In Progress", count: 1 },
    ]);
  });

  it("uses subdued border and text classes for issue-key badges by status", () => {
    const className = resolveProjectIssueKeyBadgeClassName(
      issue({
        id: "issue-1",
        key: "ENG-1",
        title: "Review item",
        state: "in_progress",
        statusName: "In Review",
      }),
    );

    expect(className).toContain("border-sky-400/35");
    expect(className).toContain("text-sky-300/90");
    expect(className).not.toContain("bg-foreground");
  });

  it("uses subdued border and text classes for status labels", () => {
    const className = resolveProjectIssueStatusBadgeClassName(
      issue({
        id: "issue-1",
        key: "ENG-1",
        title: "Done item",
        state: "done",
        statusName: "Done",
      }),
    );

    expect(className).toContain("border-emerald-400/35");
    expect(className).toContain("text-emerald-300/90");
    expect(className).not.toContain("bg-emerald-500/10");
  });

  it("uses subdued border and text classes for project provider badges", () => {
    const className = resolveProjectIssueProviderBadgeClassName();

    expect(className).toContain("border-amber-400/35");
    expect(className).toContain("text-amber-300/90");
    expect(className).not.toContain("bg-amber-400");
  });

  it("builds a useful initial prompt when starting a thread", () => {
    const prompt = buildIssueThreadDraftPrompt(
      issue({
        id: "issue-1",
        key: "ENG-1",
        title: "Render issue context",
        url: "https://linear.app/acme/issue/ENG-1",
        state: "in_progress",
        statusName: "In Progress",
        descriptionMarkdown: "Show this beside the thread.",
        assigneeName: "Mackie",
        labels: ["linear", "sidebar"],
      }),
    );

    expect(prompt).toContain("Linear issue ENG-1");
    expect(prompt).toContain("Assignee: Mackie");
    expect(prompt).toContain("Labels: linear, sidebar");
    expect(prompt).toContain("Show this beside the thread.");
  });

  it("only renders the create issue form in the modal when it is open", () => {
    expect(shouldRenderCreateIssueModal(false)).toBe(false);
    expect(shouldRenderCreateIssueModal(true)).toBe(true);
  });
});
