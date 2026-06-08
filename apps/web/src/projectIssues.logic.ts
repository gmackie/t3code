import type { IssueItem, ProjectIssueStatus } from "@t3tools/contracts";
import { cn } from "./lib/utils";

export type ProjectIssueViewMode = "list" | "kanban";

export const THREAD_ISSUE_LINKS_STORAGE_KEY = "t3code.threadIssueLinks.v1";
export const THREAD_ISSUE_LINKS_CHANGED_EVENT = "t3code.threadIssueLinks.changed";

export interface ThreadIssueLink {
  readonly provider: IssueItem["provider"];
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly url: string;
  readonly statusName: string | null;
  readonly descriptionMarkdown: string | null;
  readonly assigneeName: string | null;
  readonly labels: readonly string[];
  readonly comments: IssueItem["comments"];
}

export type ThreadIssueLinkMap = Record<string, ThreadIssueLink>;

export interface IssueStatusGroup {
  readonly label: string;
  readonly issues: readonly IssueItem[];
}

export function issueToThreadIssueLink(issue: IssueItem): ThreadIssueLink {
  return {
    provider: issue.provider,
    id: issue.id,
    key: issue.key,
    title: issue.title,
    url: issue.url,
    statusName: issue.statusName ?? null,
    descriptionMarkdown: issue.descriptionMarkdown ?? null,
    assigneeName: issue.assigneeName ?? null,
    labels: issue.labels,
    comments: issue.comments,
  };
}

export function parseThreadIssueLinks(raw: string | null): ThreadIssueLinkMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const links: ThreadIssueLinkMap = {};
    for (const [threadKey, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const candidate = value as Partial<ThreadIssueLink>;
      if (
        typeof candidate.provider === "string" &&
        typeof candidate.id === "string" &&
        typeof candidate.key === "string" &&
        typeof candidate.title === "string" &&
        typeof candidate.url === "string"
      ) {
        links[threadKey] = {
          provider: candidate.provider as IssueItem["provider"],
          id: candidate.id,
          key: candidate.key,
          title: candidate.title,
          url: candidate.url,
          statusName: typeof candidate.statusName === "string" ? candidate.statusName : null,
          descriptionMarkdown:
            typeof candidate.descriptionMarkdown === "string"
              ? candidate.descriptionMarkdown
              : null,
          assigneeName: typeof candidate.assigneeName === "string" ? candidate.assigneeName : null,
          labels: Array.isArray(candidate.labels)
            ? candidate.labels.filter((label): label is string => typeof label === "string")
            : [],
          comments: Array.isArray(candidate.comments)
            ? candidate.comments.filter(
                (comment): comment is IssueItem["comments"][number] =>
                  Boolean(comment) &&
                  typeof comment === "object" &&
                  !Array.isArray(comment) &&
                  typeof (comment as Partial<IssueItem["comments"][number]>).id === "string" &&
                  typeof (comment as Partial<IssueItem["comments"][number]>).bodyMarkdown ===
                    "string",
              )
            : [],
        };
      }
    }
    return links;
  } catch {
    return {};
  }
}

export function readThreadIssueLinks(): ThreadIssueLinkMap {
  if (typeof window === "undefined") {
    return {};
  }
  return parseThreadIssueLinks(window.localStorage.getItem(THREAD_ISSUE_LINKS_STORAGE_KEY));
}

export function writeThreadIssueLinks(links: ThreadIssueLinkMap): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(THREAD_ISSUE_LINKS_STORAGE_KEY, JSON.stringify(links));
  window.dispatchEvent(new CustomEvent(THREAD_ISSUE_LINKS_CHANGED_EVENT));
}

export function shouldRenderCreateIssueModal(open: boolean): boolean {
  return open;
}

export function shouldRenderThreadIssueSidebar(input: {
  readonly activeIssueId: string | null;
  readonly dismissedIssueId: string | null;
}): boolean {
  return Boolean(input.activeIssueId) && input.activeIssueId !== input.dismissedIssueId;
}

export function resolveIssueDisplayStatus(issue: IssueItem): string {
  return issue.statusName ?? issue.state;
}

const PROJECT_ISSUE_BADGE_COLOR_BY_STATUS_KEY: Record<string, string> = {
  backlog: "border-zinc-400/30 text-zinc-300/85",
  todo: "border-zinc-400/30 text-zinc-300/85",
  unstarted: "border-zinc-400/30 text-zinc-300/85",
  planned: "border-zinc-400/30 text-zinc-300/85",
  started: "border-cyan-400/35 text-cyan-300/90",
  working: "border-cyan-400/35 text-cyan-300/90",
  "in-progress": "border-cyan-400/35 text-cyan-300/90",
  "in progress": "border-cyan-400/35 text-cyan-300/90",
  in_progress: "border-cyan-400/35 text-cyan-300/90",
  review: "border-sky-400/35 text-sky-300/90",
  "in-review": "border-sky-400/35 text-sky-300/90",
  "in review": "border-sky-400/35 text-sky-300/90",
  done: "border-emerald-400/35 text-emerald-300/90",
  completed: "border-emerald-400/35 text-emerald-300/90",
  canceled: "border-rose-400/35 text-rose-300/90",
  cancelled: "border-rose-400/35 text-rose-300/90",
};

function normalizeIssueBadgeStatusKey(issue: IssueItem): string {
  return resolveIssueDisplayStatus(issue).trim().toLowerCase();
}

function resolveProjectIssueBadgeColorClassName(issue: IssueItem): string {
  const displayStatusClass =
    PROJECT_ISSUE_BADGE_COLOR_BY_STATUS_KEY[normalizeIssueBadgeStatusKey(issue)];
  if (displayStatusClass) return displayStatusClass;
  return (
    PROJECT_ISSUE_BADGE_COLOR_BY_STATUS_KEY[issue.state] ?? "border-amber-400/35 text-amber-300/90"
  );
}

export function resolveProjectIssueKeyBadgeClassName(issue: IssueItem): string {
  return cn(
    "rounded-md border bg-transparent px-1.5 py-0.5 font-semibold text-[10px]",
    resolveProjectIssueBadgeColorClassName(issue),
  );
}

export function resolveProjectIssueStatusBadgeClassName(issue: IssueItem): string {
  return cn(
    "rounded-md border bg-transparent px-1.5 py-0.5 font-medium text-[10px]",
    resolveProjectIssueBadgeColorClassName(issue),
  );
}

export function resolveProjectIssueProviderBadgeClassName(): string {
  return cn(
    "rounded-md border bg-transparent px-1.5 py-0.5 font-semibold text-[10px]",
    "border-amber-400/35 text-amber-300/90",
  );
}

export function resolveIssueStatusOptions(issues: readonly IssueItem[]): string[] {
  const statuses = new Set<string>();
  for (const issue of issues) {
    statuses.add(resolveIssueDisplayStatus(issue));
  }
  return [...statuses];
}

function issueStatusToSelectableStatus(issue: IssueItem): ProjectIssueStatus {
  const name = resolveIssueDisplayStatus(issue);
  return {
    id: issue.statusId ?? name,
    name,
    state: issue.state,
  };
}

export function resolveSelectableIssueStatuses(input: {
  readonly statuses: readonly ProjectIssueStatus[];
  readonly issues: readonly IssueItem[];
}): ProjectIssueStatus[] {
  const statusesById = new Map<string, ProjectIssueStatus>();
  const addStatus = (status: ProjectIssueStatus) => {
    if (!statusesById.has(status.id)) {
      statusesById.set(status.id, status);
    }
  };

  for (const status of input.statuses) {
    addStatus(status);
  }
  for (const issue of input.issues) {
    addStatus(issueStatusToSelectableStatus(issue));
  }

  if (statusesById.size === 0) {
    addStatus({ id: "Backlog", name: "Backlog", state: "open" });
  }

  return [...statusesById.values()];
}

export function groupIssuesByStatus(issues: readonly IssueItem[]): IssueStatusGroup[] {
  const groups = new Map<string, IssueItem[]>();
  for (const issue of issues) {
    const status = resolveIssueDisplayStatus(issue);
    const group = groups.get(status) ?? [];
    group.push(issue);
    groups.set(status, group);
  }
  return [...groups.entries()].map(([label, groupedIssues]) => ({
    label,
    issues: groupedIssues,
  }));
}
