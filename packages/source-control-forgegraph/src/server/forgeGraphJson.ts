/**
 * ForgeGraph's `/api/fg` answers, and how they become the providers' neutral shapes.
 *
 * Fields that FORGE-138 adds (a native per-repository `number`, `url`, `body`, `updatedAt`,
 * branches on list items) are optional here, so the same code reads an older server and a newer
 * one; a field's absence is never taken to mean anything but "not reported".
 *
 * @module source-control-forgegraph/server/forgeGraphJson
 */
import type {
  PullRequestAction,
  PullRequestActor,
  PullRequestCheck,
  PullRequestChecksState,
  PullRequestComment,
  PullRequestMergeCapabilities,
  PullRequestMergeability,
  PullRequestState,
  PullRequestViewerPermissions,
} from "@t3tools/contracts";
import type {
  ProviderChangeRequest,
  ProviderChangeRequestActivity,
} from "@t3tools/source-control-core/server/PullRequestProvider";
import * as Schema from "effect/Schema";

import { forgeGraphChangesetUrl, forgeGraphCiRunUrl } from "./forgeGraphHosts.ts";

const Text = Schema.String;
const OptionalText = Schema.optional(Schema.NullOr(Schema.String));

export const ForgeGraphWhoami = Schema.Struct({
  user: Schema.NullOr(Schema.String),
  userId: Schema.NullOr(Schema.String),
});

export const ForgeGraphRepository = Schema.Struct({
  id: Text,
  slug: Text,
  owner: Text,
  repoName: Text,
  defaultBranch: OptionalText,
});
export const ForgeGraphResolve = Schema.Struct({
  repository: Schema.NullOr(ForgeGraphRepository),
});
export type ForgeGraphRepository = typeof ForgeGraphRepository.Type;

export const ForgeGraphApps = Schema.Struct({
  apps: Schema.Array(
    Schema.Struct({
      slug: Text,
      repositoryId: Schema.NullOr(Text),
    }),
  ),
});

export const ChangesetStatus = Schema.Literals([
  "draft",
  "open",
  "changes_requested",
  "approved",
  "merging",
  "merged",
  "closed",
]);
export type ChangesetStatus = typeof ChangesetStatus.Type;

const OptionalNumber = Schema.optional(Schema.NullOr(Schema.Int));

export const ForgeGraphPullListItem = Schema.Struct({
  id: Text,
  title: Text,
  status: ChangesetStatus,
  createdAt: Text,
  updatedAt: OptionalText,
  number: OptionalNumber,
});
export const ForgeGraphPullList = Schema.Struct({ prs: Schema.Array(ForgeGraphPullListItem) });
export type ForgeGraphPullListItem = typeof ForgeGraphPullListItem.Type;

const MergeEntry = Schema.Struct({
  status: Text,
  reason: OptionalText,
  strategy: OptionalText,
  updatedAt: OptionalText,
});

const Comment = Schema.Struct({
  id: Text,
  author: Text,
  content: Text,
  filePath: OptionalText,
  lineNumber: OptionalText,
  createdAt: Text,
});

const Review = Schema.Struct({
  id: Text,
  author: Text,
  verdict: Schema.Literals(["approved", "changes_requested", "commented"]),
  body: OptionalText,
  reviewedSha: OptionalText,
  current: Schema.optional(Schema.Boolean),
  createdAt: Text,
});

export const ForgeGraphPullDetail = Schema.Struct({
  id: Text,
  title: Text,
  status: ChangesetStatus,
  author: Text,
  createdAt: Text,
  updatedAt: OptionalText,
  headSha: OptionalText,
  sourceBranch: OptionalText,
  targetBranch: Text,
  number: OptionalNumber,
  url: OptionalText,
  body: OptionalText,
  prBackend: Schema.optional(Schema.Literals(["forgejo", "native"])),
  merge: Schema.optional(Schema.NullOr(MergeEntry)),
  comments: Schema.Array(Comment),
  reviews: Schema.Array(Review),
});
export type ForgeGraphPullDetail = typeof ForgeGraphPullDetail.Type;

export const ForgeGraphCreated = Schema.Struct({
  id: Text,
  pullRequest: Schema.optional(
    Schema.Struct({
      opened: Schema.Boolean,
      reason: OptionalText,
      error: OptionalText,
    }),
  ),
});

const BuildStatus = Schema.Literals(["queued", "running", "passed", "failed", "cancelled"]);

export const ForgeGraphGate = Schema.Struct({
  status: Schema.Literals(["pass", "pending", "fail", "none"]),
  builds: Schema.Array(
    Schema.Struct({
      id: Text,
      pipelineName: Text,
      status: Schema.Union([BuildStatus, Text]),
    }),
  ),
});
export type ForgeGraphGate = typeof ForgeGraphGate.Type;

/** A detail that can stand for a T3 change request: it has a number and a branch. */
export type NumberedPull = ForgeGraphPullDetail & {
  readonly number: number;
  readonly sourceBranch: string;
};

/**
 * Whether T3 can address the pull request. It needs ForgeGraph's own per-repository number, which
 * native pull requests only carry once the server assigns them (FORGE-138); T3 never makes one up.
 */
export function isNumbered(pull: ForgeGraphPullDetail): pull is NumberedPull {
  return (
    typeof pull.number === "number" &&
    Number.isSafeInteger(pull.number) &&
    pull.number > 0 &&
    typeof pull.sourceBranch === "string" &&
    pull.sourceBranch.trim().length > 0
  );
}

export function toState(status: ChangesetStatus): PullRequestState {
  return status === "merged" ? "merged" : status === "closed" ? "closed" : "open";
}

/** The listing states ForgeGraph has for a `state` filter. */
export function matchesListState(
  status: ChangesetStatus,
  state: "open" | "closed" | "merged" | "all",
) {
  return state === "all" || toState(status) === state;
}

const actor = (name: string): PullRequestActor | null =>
  name.trim().length === 0 || name === "unknown"
    ? null
    : { login: name.trim(), name: null, avatarUrl: null };

/** The latest moment the detail says anything changed, for an older server with no `updatedAt`. */
export function lastActivityAt(pull: ForgeGraphPullDetail): string {
  if (pull.updatedAt) return pull.updatedAt;
  return [
    pull.createdAt,
    pull.merge?.updatedAt ?? null,
    ...pull.comments.map((comment) => comment.createdAt),
    ...pull.reviews.map((review) => review.createdAt),
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .reduce((latest, value) => (value > latest ? value : latest));
}

function mergeability(pull: ForgeGraphPullDetail): PullRequestMergeability {
  return pull.merge?.status === "conflict" ? "conflicting" : "unknown";
}

export function toChecksState(gate: ForgeGraphGate | null): PullRequestChecksState | null {
  switch (gate?.status) {
    case "pass":
      return "passing";
    case "fail":
      return "failing";
    case "pending":
      return "pending";
    default:
      return null;
  }
}

export function toChangeRequest(pull: NumberedPull, server: string): ProviderChangeRequest {
  return {
    number: pull.number,
    title: pull.title,
    url: pull.url ?? forgeGraphChangesetUrl(server, pull.id),
    author: actor(pull.author),
    headBranch: pull.sourceBranch,
    baseBranch: pull.targetBranch,
    state: toState(pull.status),
    isDraft: pull.status === "draft",
    mergeability: mergeability(pull),
    additions: 0,
    deletions: 0,
    createdAt: pull.createdAt,
    updatedAt: lastActivityAt(pull),
    reviewRequestLogins: [],
    labels: [],
  };
}

const CHECK_STATUS: Readonly<Record<string, PullRequestCheck["status"]>> = {
  queued: "pending",
  running: "pending",
  passed: "success",
  failed: "failure",
  cancelled: "cancelled",
};

/** ForgeGraph CI builds on the head, each linked to its run page on the server. */
export function toChecks(gate: ForgeGraphGate | null, server: string): Array<PullRequestCheck> {
  return (gate?.builds ?? []).map((build) => ({
    name: build.pipelineName,
    status: CHECK_STATUS[build.status] ?? "neutral",
    description: null,
    url: forgeGraphCiRunUrl(server, build.id),
  }));
}

/** Merges ForgeGraph accepts in the pull request's state, by backend. */
function canMerge(pull: ForgeGraphPullDetail): boolean {
  return pull.status === "open" || pull.status === "approved";
}

/**
 * Native PRs merge by merge, squash, or fast-forward; Forgejo-backed ones by merge, squash, or
 * rebase. T3 has no fast-forward method, so a native PR offers no rebase.
 */
export function toMergeCapabilities(pull: ForgeGraphPullDetail): PullRequestMergeCapabilities {
  const open = canMerge(pull);
  return { merge: open, squash: open, rebase: open && pull.prBackend !== "native" };
}

/**
 * What can be done with the pull request. Merge-when-green is only offered on the Forgejo backend,
 * the only one whose `whenGreen` ForgeGraph honours today.
 */
export function toViewerPermissions(pull: ForgeGraphPullDetail): PullRequestViewerPermissions {
  const open = toState(pull.status) === "open";
  const actions: Array<PullRequestAction> = [
    ...(canMerge(pull) ? (["merge"] as const) : []),
    ...(canMerge(pull) && pull.prBackend !== "native" ? (["enable-auto-merge"] as const) : []),
    ...(open && pull.status !== "merging" ? (["close"] as const) : []),
  ];
  return {
    actions,
    comment: true,
    resolve: false,
    verdicts: open ? ["approve", "request-changes", "comment"] : [],
    requestReviewers: false,
    updateMethods: [],
    labels: false,
    editChangeRequest: false,
  };
}

/** The verdict ForgeGraph names for a review T3 submits. */
export const REVIEW_VERDICT = {
  approve: "approved",
  "request-changes": "changes_requested",
  comment: "commented",
} as const;

export function toActivity(pull: ForgeGraphPullDetail): ProviderChangeRequestActivity {
  const comments: Array<PullRequestComment> = [
    // ForgeGraph has no review threads yet (FORGE-138), so a line comment is a file remark.
    ...pull.comments.map((comment) => ({
      id: comment.id,
      kind: comment.filePath ? ("review-comment" as const) : ("issue-comment" as const),
      author: actor(comment.author),
      body: comment.content,
      createdAt: comment.createdAt,
      url: null,
      path: comment.filePath || null,
      reviewState: null,
    })),
    ...pull.reviews.map((review) => ({
      id: review.id,
      kind: "review" as const,
      author: actor(review.author),
      body: review.body ?? "",
      createdAt: review.createdAt,
      url: null,
      path: null,
      // A verdict on an older head no longer counts towards ForgeGraph's merge gate.
      reviewState: review.current === false ? "dismissed" : review.verdict,
    })),
  ];
  return {
    comments: comments.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt)),
    commentCount: comments.length,
    commentsTruncated: false,
    reviewThreads: [],
    commits: [],
  };
}
