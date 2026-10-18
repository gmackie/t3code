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
  PullRequestReviewThread,
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
  prBackend: Schema.optional(Schema.Literals(["forgejo", "native"])),
  storageBackend: Schema.optional(Schema.Literals(["forgejo", "artifacts"])),
  /**
   * The URL to fetch from: the gateway for a repository whose storage is Cloudflare Artifacts,
   * which must never be fetched from Forgejo, and the Forgejo https URL otherwise.
   */
  cloneUrl: OptionalText,
  webUrl: OptionalText,
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

const MergeEntry = Schema.Struct({
  status: Text,
  reason: OptionalText,
  strategy: OptionalText,
  updatedAt: OptionalText,
});

/**
 * A remark. A server with threads (FORGE-138 item 6) adds `parentId`, `line`, `side`, and the
 * thread root's `resolved`; `parentId` being present at all is what says the server has them.
 */
const Comment = Schema.Struct({
  id: Text,
  parentId: Schema.optional(Schema.NullOr(Text)),
  author: Text,
  body: OptionalText,
  /** The older name for `body`, kept by newer servers too. */
  content: OptionalText,
  filePath: OptionalText,
  line: OptionalNumber,
  side: Schema.optional(Schema.NullOr(Schema.Literals(["old", "new"]))),
  lineNumber: OptionalText,
  resolved: Schema.optional(Schema.NullOr(Schema.Boolean)),
  createdAt: Text,
  updatedAt: OptionalText,
});
type Comment = typeof Comment.Type;

/** A standing merge-when-green request, pinned to the head it was made at. */
const AutoMerge = Schema.Struct({
  headSha: OptionalText,
  strategy: OptionalText,
  requestedAt: OptionalText,
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

/**
 * One pull request, in any of the shapes ForgeGraph answers with: the thin `?app=` list item
 * (id, title, status, author, createdAt), the `PrSummary` the repository listing returns, and the
 * detail, which adds the body, merge state, and conversation.
 */
export const ForgeGraphPull = Schema.Struct({
  id: Text,
  title: Text,
  status: ChangesetStatus,
  state: Schema.optional(Schema.Literals(["open", "closed", "merged"])),
  isDraft: Schema.optional(Schema.Boolean),
  author: Schema.optional(Text),
  createdAt: Text,
  updatedAt: OptionalText,
  headSha: OptionalText,
  sourceBranch: OptionalText,
  targetBranch: OptionalText,
  number: OptionalNumber,
  url: OptionalText,
  /** CI on the head commit only. */
  ci: Schema.optional(Schema.NullOr(Schema.Literals(["pass", "fail", "running"]))),
  body: OptionalText,
  prBackend: Schema.optional(Schema.Literals(["forgejo", "native"])),
  mergeStrategies: Schema.optional(Schema.Array(Text)),
  merge: Schema.optional(Schema.NullOr(MergeEntry)),
  /**
   * The pending merge-when-green request, null when there is none. Absent from a server that
   * cannot hold one for a native pull request, which ignores `whenGreen` and merges at once.
   */
  autoMerge: Schema.optional(Schema.NullOr(AutoMerge)),
  comments: Schema.optional(Schema.Array(Comment)),
  reviews: Schema.optional(Schema.Array(Review)),
});
export type ForgeGraphPull = typeof ForgeGraphPull.Type;

/** `nextCursor` is only present on the repository listing, which is how it is told apart. */
export const ForgeGraphPullList = Schema.Struct({
  prs: Schema.Array(ForgeGraphPull),
  nextCursor: Schema.optional(Schema.NullOr(Text)),
});

export const ForgeGraphMergeability = Schema.Struct({
  mergeable: Schema.Literals(["mergeable", "conflicting", "unknown"]),
  strategies: Schema.optional(Schema.Array(Text)),
  autoMerge: Schema.optional(Schema.NullOr(AutoMerge)),
});
export type ForgeGraphMergeability = typeof ForgeGraphMergeability.Type;

export const ForgeGraphMergeCancelled = Schema.Struct({ cancelled: Schema.Boolean });

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

/** A pull request that can stand for a T3 change request: it has a number and both branches. */
export type NumberedPull = ForgeGraphPull & {
  readonly number: number;
  readonly sourceBranch: string;
  readonly targetBranch: string;
};

/**
 * Whether T3 can address the pull request. It needs ForgeGraph's own per-repository number: the
 * Forgejo PR's on that backend, ForgeGraph's own on native (allocated above every Forgejo number
 * the repository used, so the two never collide). It is null for drafts and for a Forgejo-backed
 * changeset with no Forgejo PR, and a pull request without one is left out; T3 never makes one up.
 */
export function isNumbered(pull: ForgeGraphPull): pull is NumberedPull {
  return (
    typeof pull.number === "number" &&
    Number.isSafeInteger(pull.number) &&
    pull.number > 0 &&
    typeof pull.sourceBranch === "string" &&
    pull.sourceBranch.trim().length > 0 &&
    typeof pull.targetBranch === "string" &&
    pull.targetBranch.trim().length > 0
  );
}

function toState(status: ChangesetStatus): PullRequestState {
  return status === "merged" ? "merged" : status === "closed" ? "closed" : "open";
}

/** The server's own `state` where it reports one, else the one the changeset status implies. */
export const stateOf = (pull: ForgeGraphPull): PullRequestState =>
  pull.state ?? toState(pull.status);

/** The listing states ForgeGraph has for a `state` filter. */
export function matchesListState(
  status: ChangesetStatus,
  state: "open" | "closed" | "merged" | "all",
) {
  return state === "all" || toState(status) === state;
}

const actor = (name: string | undefined): PullRequestActor | null =>
  name === undefined || name.trim().length === 0 || name === "unknown"
    ? null
    : { login: name.trim(), name: null, avatarUrl: null };

/** The latest moment the detail says anything changed, for an older server with no `updatedAt`. */
export function lastActivityAt(pull: ForgeGraphPull): string {
  if (pull.updatedAt) return pull.updatedAt;
  return [
    pull.createdAt,
    pull.merge?.updatedAt ?? null,
    ...(pull.comments ?? []).map((comment) => comment.createdAt),
    ...(pull.reviews ?? []).map((review) => review.createdAt),
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .reduce((latest, value) => (value > latest ? value : latest));
}

function mergeability(pull: ForgeGraphPull): PullRequestMergeability {
  return pull.merge?.status === "conflict" ? "conflicting" : "unknown";
}

/**
 * The head's CI rollup: the gate's when it was read, else the summary's own `ci`, which a newer
 * server lists with every pull request.
 */
export function toChecksState(
  gate: ForgeGraphGate | null,
  pull?: ForgeGraphPull,
): PullRequestChecksState | null {
  switch (gate?.status ?? pull?.ci) {
    case "pass":
      return "passing";
    case "fail":
      return "failing";
    case "pending":
    case "running":
      return "pending";
    default:
      return null;
  }
}

export function toChangeRequest(pull: NumberedPull, server: string): ProviderChangeRequest {
  const checksState = toChecksState(null, pull);
  return {
    number: pull.number,
    title: pull.title,
    url: pull.url ?? forgeGraphChangesetUrl(server, pull.id),
    author: actor(pull.author),
    headBranch: pull.sourceBranch,
    baseBranch: pull.targetBranch,
    state: stateOf(pull),
    isDraft: pull.isDraft ?? pull.status === "draft",
    mergeability: mergeability(pull),
    additions: 0,
    deletions: 0,
    createdAt: pull.createdAt,
    updatedAt: lastActivityAt(pull),
    reviewRequestLogins: [],
    labels: [],
    ...(checksState === null ? {} : { checksState }),
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
function canMerge(pull: ForgeGraphPull): boolean {
  return pull.status === "open" || pull.status === "approved";
}

/**
 * The strategies ForgeGraph lists for the pull request, or the ones its backend has: native merges
 * by merge, squash, or fast-forward, Forgejo-backed by merge, squash, or rebase. T3 has no
 * fast-forward method, so a native PR offers no rebase.
 */
export function toMergeCapabilities(
  pull: ForgeGraphPull,
  mergeability?: ForgeGraphMergeability | null,
): PullRequestMergeCapabilities {
  const open = canMerge(pull);
  const strategies =
    mergeability?.strategies ??
    pull.mergeStrategies ??
    (pull.prBackend === "native"
      ? ["merge", "squash", "fast-forward"]
      : ["merge", "squash", "rebase"]);
  return {
    merge: open && strategies.includes("merge"),
    squash: open && strategies.includes("squash"),
    rebase: open && strategies.includes("rebase"),
  };
}

/**
 * Whether ForgeGraph can hold a merge-when-green request for this pull request. The Forgejo backend
 * always could, through Forgejo's auto-merge. A native one only can on a server that reports
 * `autoMerge`; an older server ignores `whenGreen` there and merges at once, so it is never asked.
 */
export function canMergeWhenGreen(pull: ForgeGraphPull): boolean {
  return pull.prBackend !== "native" || pull.autoMerge !== undefined;
}

/** Whether the server reports review threads: its remarks carry `parentId`, null or not. */
export function hasThreads(pull: ForgeGraphPull): boolean {
  return (pull.comments ?? []).some((comment) => comment.parentId !== undefined);
}

/** What can be done with the pull request. */
export function toViewerPermissions(pull: ForgeGraphPull): PullRequestViewerPermissions {
  const open = stateOf(pull) === "open";
  // A pending request is only known where the server reports one, which it does for native.
  const armed = pull.autoMerge != null;
  const actions: Array<PullRequestAction> = [
    ...(canMerge(pull) ? (["merge"] as const) : []),
    ...(canMerge(pull) && !armed && canMergeWhenGreen(pull)
      ? (["enable-auto-merge"] as const)
      : []),
    ...(armed ? (["disable-auto-merge"] as const) : []),
    ...(open && pull.status !== "merging" ? (["close"] as const) : []),
  ];
  return {
    actions,
    comment: true,
    resolve: hasThreads(pull),
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

const commentBody = (comment: Comment) => comment.body ?? comment.content ?? "";

/** A remark anchored to a line: a thread root, or a reply that hangs off one. */
const isInline = (comment: Comment) => Boolean(comment.filePath) && (comment.line ?? 0) > 0;

/**
 * ForgeGraph's threads are one level deep: a reply names its root in `parentId` and takes the
 * root's anchor and resolution. Only inline roots make review threads; a reply to a general remark
 * stays in the conversation.
 */
function toReviewThreads(comments: ReadonlyArray<Comment>): Array<PullRequestReviewThread> {
  const replies = new Map<string, Array<Comment>>();
  for (const comment of comments)
    if (comment.parentId)
      replies.set(comment.parentId, [...(replies.get(comment.parentId) ?? []), comment]);
  return comments
    .filter((comment) => !comment.parentId && isInline(comment))
    .map((root) => ({
      id: root.id,
      path: root.filePath!,
      line: root.line ?? null,
      side: root.side === "old" ? ("left" as const) : ("right" as const),
      isResolved: root.resolved === true,
      isOutdated: false,
      canResolve: true,
      comments: [root, ...(replies.get(root.id) ?? [])].map((comment) => ({
        id: comment.id,
        author: actor(comment.author),
        body: commentBody(comment),
        createdAt: comment.createdAt,
        url: null,
      })),
    }));
}

export function toActivity(pull: ForgeGraphPull): ProviderChangeRequestActivity {
  const remarks = pull.comments ?? [];
  const threaded = hasThreads(pull);
  const inlineIds = new Set(
    remarks
      .filter((comment) => !comment.parentId && isInline(comment))
      .map((comment) => comment.id),
  );
  const comments: Array<PullRequestComment> = [
    ...remarks.map((comment) => ({
      id: comment.id,
      // On a server without threads, a remark on a file is still shown as one.
      kind:
        comment.filePath || (comment.parentId && inlineIds.has(comment.parentId))
          ? ("review-comment" as const)
          : ("issue-comment" as const),
      author: actor(comment.author),
      body: commentBody(comment),
      createdAt: comment.createdAt,
      ...(comment.updatedAt && comment.updatedAt !== comment.createdAt
        ? { editedAt: comment.updatedAt }
        : {}),
      url: null,
      path: comment.filePath || null,
      reviewState: null,
    })),
    ...(pull.reviews ?? []).map((review) => ({
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
    reviewThreads: threaded ? toReviewThreads(remarks) : [],
    commits: [],
  };
}
