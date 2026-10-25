import {
  McpCapabilityUnavailableError,
  OrchestratorMcpEnvironmentTarget,
  OrchestratorMcpFailure,
  PositiveInt,
  PullRequestMergeMethod,
  PullRequestReadiness,
  PullRequestReviewGuide,
  PullRequestReviewGuideRun,
  PullRequestReviewVerdict,
  PullRequestState,
  ThreadPullRequestLinkSource,
  TrimmedNonEmptyString,
  ThreadId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as McpSchema from "effect/ai/McpSchema";
import * as Tool from "effect/ai/Tool";
import * as Toolkit from "effect/ai/Toolkit";

import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as Orchestrator from "../../../orchestration-v2/Orchestrator.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../../../project/ProjectService.ts";
import * as PullRequestReviewGuideService from "../../../pullRequest/PullRequestReviewGuideService.ts";
import * as PullRequestService from "../../../pullRequest/PullRequestService.ts";

const dependencies = [
  McpInvocationContext.McpInvocationContext,
  ThreadManagementService.ThreadManagementService,
  Orchestrator.OrchestratorV2,
  ProjectService.ProjectService,
];

const guideDependencies = [
  ...dependencies,
  PullRequestReviewGuideService.PullRequestReviewGuideService,
];

const hostDependencies = [...dependencies, PullRequestService.PullRequestService];

export const PullRequestTargetInput = Schema.Struct({
  environmentId: OrchestratorMcpEnvironmentTarget,
  threadId: Schema.optional(
    ThreadId.annotate({
      description: "Thread. Default: this thread.",
    }),
  ),
  url: Schema.optional(TrimmedNonEmptyString),
  repository: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description: "With `number`, when no `url`.",
    }),
  ),
  number: Schema.optional(
    PositiveInt.annotate({
      description: "With `repository`, when no `url`.",
    }),
  ),
  host: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description: "Default: this project's host.",
    }),
  ),
});
export type PullRequestTargetInput = typeof PullRequestTargetInput.Type;

export class PullRequestUrlInvalidError extends Schema.TaggedError<PullRequestUrlInvalidError>()(
  "PullRequestUrlInvalidError",
  {},
) {
  override get message(): string {
    return "This is not a recognised pull request URL. Pass repository and number instead.";
  }
}

export class PullRequestTargetIncompleteError extends Schema.TaggedError<PullRequestTargetIncompleteError>()(
  "PullRequestTargetIncompleteError",
  {},
) {
  override get message(): string {
    return "Pass either url, or both repository and number.";
  }
}

export class PullRequestHostRequiredError extends Schema.TaggedError<PullRequestHostRequiredError>()(
  "PullRequestHostRequiredError",
  {},
) {
  override get message(): string {
    return "This thread's project has no recognised remote. Pass host or url.";
  }
}

export class PullRequestUrlUnavailableError extends Schema.TaggedError<PullRequestUrlUnavailableError>()(
  "PullRequestUrlUnavailableError",
  {},
) {
  override get message(): string {
    return "This thread's project is on a host with no known pull request URL shape. Pass url.";
  }
}

export class PullRequestThreadRequiredError extends Schema.TaggedError<PullRequestThreadRequiredError>()(
  "PullRequestThreadRequiredError",
  {},
) {
  override get message(): string {
    return "Pass threadId: this MCP client is not running inside a T3 thread.";
  }
}

export class PullRequestThreadNotFoundError extends Schema.TaggedError<PullRequestThreadNotFoundError>()(
  "PullRequestThreadNotFoundError",
  { threadId: Schema.String },
) {
  override get message(): string {
    return `Thread ${this.threadId} was not found.`;
  }
}

export class PullRequestLinkFailedError extends Schema.TaggedError<PullRequestLinkFailedError>()(
  "PullRequestLinkFailedError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not link the pull request.";
  }
}

export class PullRequestUnlinkFailedError extends Schema.TaggedError<PullRequestUnlinkFailedError>()(
  "PullRequestUnlinkFailedError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not unlink the pull request.";
  }
}

export class PullRequestWatchFailedError extends Schema.TaggedError<PullRequestWatchFailedError>()(
  "PullRequestWatchFailedError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not change whether the pull request is watched.";
  }
}

export class PullRequestNotOpenError extends Schema.TaggedError<PullRequestNotOpenError>()(
  "PullRequestNotOpenError",
  { state: Schema.String },
) {
  override get message(): string {
    return `The pull request is ${this.state}, so there is nothing to watch.`;
  }
}

export class PullRequestWatchFromSubagentError extends Schema.TaggedError<PullRequestWatchFromSubagentError>()(
  "PullRequestWatchFromSubagentError",
  {},
) {
  override get message(): string {
    return "This thread is a subagent, so it cannot watch pull requests. Its parent thread owns the pull request: finish your task and report back instead.";
  }
}

export class PullRequestListFailedError extends Schema.TaggedError<PullRequestListFailedError>()(
  "PullRequestListFailedError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not list the pull request.";
  }
}

export class PullRequestProjectNotFoundError extends Schema.TaggedError<PullRequestProjectNotFoundError>()(
  "PullRequestProjectNotFoundError",
  { repository: Schema.String },
) {
  override get message(): string {
    return `No project in this environment is a checkout of ${this.repository}, so its pull requests cannot be read here. Add one with t3_project_create.`;
  }
}

export class PullRequestGuideFailedError extends Schema.TaggedError<PullRequestGuideFailedError>()(
  "PullRequestGuideFailedError",
  { detail: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {
  override get message(): string {
    return this.detail;
  }
}

/** The host or the service refused or failed a read or a write; `detail` says why in its words. */
export class PullRequestHostOperationFailedError extends Schema.TaggedError<PullRequestHostOperationFailedError>()(
  "PullRequestHostOperationFailedError",
  { detail: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {
  override get message(): string {
    return this.detail;
  }
}

export const PullRequestToolError = Schema.Union([
  OrchestratorMcpFailure,
  McpCapabilityUnavailableError,
  PullRequestUrlInvalidError,
  PullRequestTargetIncompleteError,
  PullRequestHostRequiredError,
  PullRequestUrlUnavailableError,
  PullRequestThreadRequiredError,
  PullRequestThreadNotFoundError,
  PullRequestLinkFailedError,
  PullRequestUnlinkFailedError,
  PullRequestListFailedError,
  PullRequestWatchFailedError,
  PullRequestNotOpenError,
  PullRequestWatchFromSubagentError,
  PullRequestProjectNotFoundError,
  PullRequestGuideFailedError,
  PullRequestHostOperationFailedError,
]);
export type PullRequestToolError = typeof PullRequestToolError.Type;

const PullRequestIdentity = {
  host: Schema.String,
  repository: Schema.String,
  number: Schema.Int,
  url: Schema.String,
};

export const LinkPullRequestResult = Schema.Struct({
  ...PullRequestIdentity,
  alreadyLinked: Schema.Boolean,
});
export type LinkPullRequestResult = typeof LinkPullRequestResult.Type;

export const UnlinkPullRequestResult = Schema.Struct({
  host: Schema.String,
  repository: Schema.String,
  number: Schema.Int,
  wasLinked: Schema.Boolean,
});
export type UnlinkPullRequestResult = typeof UnlinkPullRequestResult.Type;

export const WatchPullRequestResult = Schema.Struct({
  ...PullRequestIdentity,
  watching: Schema.Boolean,
  wasWatching: Schema.Boolean,
});
export type WatchPullRequestResult = typeof WatchPullRequestResult.Type;

export const ThreadPullRequestEntry = Schema.Struct({
  ...PullRequestIdentity,
  source: ThreadPullRequestLinkSource,
  watching: Schema.Boolean,
  state: Schema.NullOr(PullRequestState),
  title: Schema.NullOr(Schema.String),
  headBranch: Schema.NullOr(Schema.String),
  baseBranch: Schema.NullOr(Schema.String),
  isDraft: Schema.NullOr(Schema.Boolean),
  stack: Schema.NullOr(
    Schema.Struct({
      kind: Schema.Literals(["native", "derived"]),
      /** 1-based layer from the bottom; siblings share a layer. */
      position: Schema.Int,
      size: Schema.Int,
    }),
  ),
});
export type ThreadPullRequestEntry = typeof ThreadPullRequestEntry.Type;

export const ListThreadPullRequestsResult = Schema.Struct({
  pullRequests: Schema.Array(ThreadPullRequestEntry),
  chains: Schema.Array(
    Schema.Struct({
      kind: Schema.Literals(["native", "derived"]),
      /** Bottom to top; each pull request comes before the ones built on it. */
      numbers: Schema.Array(Schema.Int),
    }),
  ),
});
export type ListThreadPullRequestsResult = typeof ListThreadPullRequestsResult.Type;

const LinkPullRequestTool = Tool.make("link_pull_request", {
  description: "Link a PR to this thread. T3 shows its status and settles the thread on merge.",
  parameters: PullRequestTargetInput,
  success: LinkPullRequestResult,
  failure: PullRequestToolError,
  dependencies,
})
  .annotate(Tool.Title, "Link pull request to thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const UnlinkPullRequestTool = Tool.make("unlink_pull_request", {
  description:
    "Remove a PR link from this thread. Succeeds with `wasLinked=false` when it was not linked.",
  parameters: PullRequestTargetInput,
  success: UnlinkPullRequestResult,
  failure: PullRequestToolError,
  dependencies,
})
  .annotate(Tool.Title, "Unlink pull request from thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const ListThreadPullRequestsTool = Tool.make("list_thread_pull_requests", {
  description:
    "List PRs linked to a thread, with last known state and stack order (bottom to top). Call only when you need that list. Never as an end-of-work check.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    threadId: Schema.optional(ThreadId.annotate({ description: "Thread. Default: this thread." })),
  }),
  success: ListThreadPullRequestsResult,
  failure: PullRequestToolError,
  dependencies,
})
  .annotate(Tool.Title, "List thread pull requests")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const WatchPullRequestTool = Tool.make("watch_pull_request", {
  description:
    "Watch an open PR for this thread, linking it first if needed. T3 wakes you on failed checks, passed required checks, new comments or reviews, or conflicts. Handle old comments first. Only later ones wake you. After this call, end your turn. The watch stays on after each wake, so do not call this again on a wake. A wake is not a merge decision. Check readiness yourself.",
  parameters: PullRequestTargetInput,
  success: WatchPullRequestResult,
  failure: PullRequestToolError,
  dependencies,
})
  .annotate(Tool.Title, "Watch pull request")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromSubagents);

const UnwatchPullRequestTool = Tool.make("unwatch_pull_request", {
  description: "Stop watching a PR for this thread. It stays linked.",
  parameters: PullRequestTargetInput,
  success: WatchPullRequestResult,
  failure: PullRequestToolError,
  dependencies,
})
  .annotate(Tool.Title, "Stop watching pull request")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromSubagents);

const GuideTarget = Schema.Struct({
  url: PullRequestTargetInput.fields.url,
  repository: PullRequestTargetInput.fields.repository,
  number: PullRequestTargetInput.fields.number,
  host: PullRequestTargetInput.fields.host,
});

const GuideOutcome = Schema.Struct({
  ...PullRequestIdentity,
  outcome: Schema.Literals(["started", "running", "failed"]).annotate({
    description: "started: a run began. running: joined a run for this head. failed: see detail.",
  }),
  detail: Schema.NullOr(Schema.String),
});

export const WritePullRequestGuidesResult = Schema.Struct({
  guides: Schema.Array(GuideOutcome),
});
export type WritePullRequestGuidesResult = typeof WritePullRequestGuidesResult.Type;

export const ReadPullRequestGuideResult = Schema.Struct({
  ...PullRequestIdentity,
  guide: Schema.NullOr(PullRequestReviewGuide),
  run: Schema.NullOr(PullRequestReviewGuideRun),
  currentHeadSha: Schema.NullOr(Schema.String),
  stale: Schema.Boolean.annotate({
    description: "True when the PR head moved after the guide was written.",
  }),
});
export type ReadPullRequestGuideResult = typeof ReadPullRequestGuideResult.Type;

const WritePullRequestGuidesTool = Tool.make("write_pull_request_guides", {
  description:
    "Write review guides for up to 20 PRs (the tour in the PR Guide tab). Returns once runs start. Each run takes minutes in a temporary checkout. A run for the same head is joined. Read with `read_pull_request_guide`. Fails while guides are off.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    pullRequests: Schema.Array(GuideTarget).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  }),
  success: WritePullRequestGuidesResult,
  failure: PullRequestToolError,
  dependencies: guideDependencies,
})
  .annotate(Tool.Title, "Write pull request guides")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

const ReadPullRequestGuideTool = Tool.make("read_pull_request_guide", {
  description:
    "Read a PR's stored review guide and run state. `guide` is null when none exists. Never starts a run.",
  parameters: Schema.Struct({
    environmentId: OrchestratorMcpEnvironmentTarget,
    ...GuideTarget.fields,
  }),
  success: ReadPullRequestGuideResult,
  failure: PullRequestToolError,
  dependencies: guideDependencies,
})
  .annotate(Tool.Title, "Read pull request guide")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

/**
 * A pull request on its host, by URL or by repository and number. These tools act on the host,
 * not on a T3 thread, so they take no threadId; the pull request is read and written through a
 * project in this environment whose checkout is that repository.
 */
const HostTarget = GuideTarget;

const ExpectedHeadSha = Schema.optional(
  TrimmedNonEmptyString.annotate({
    description:
      "Act only if the pull request's head commit is still this SHA (full, or at least 7 leading characters), for example the commit whose checks you verified. Refused when someone pushed since.",
  }),
);

export const ReadPullRequestResult = Schema.Struct({
  ...PullRequestIdentity,
  readiness: PullRequestReadiness,
});
export type ReadPullRequestResult = typeof ReadPullRequestResult.Type;

export const ListReviewThreadsResult = Schema.Struct({
  ...PullRequestIdentity,
  reviewThreads: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      path: Schema.String,
      line: Schema.NullOr(Schema.Int),
      isResolved: Schema.Boolean,
      isOutdated: Schema.Boolean,
      comments: Schema.Array(
        Schema.Struct({
          id: Schema.String,
          author: Schema.NullOr(Schema.String),
          body: Schema.String,
          createdAt: Schema.String,
        }),
      ),
    }),
  ),
  truncated: Schema.Boolean.annotate({
    description: "True when the host listing stopped before every thread was read.",
  }),
});
export type ListReviewThreadsResult = typeof ListReviewThreadsResult.Type;

const PullRequestWriteResult = Schema.Struct(PullRequestIdentity);

const ReadPullRequestTool = Tool.make("read_pull_request", {
  description:
    "Read a PR's readiness fresh from its host: state, head, mergeability, checks (required marked), auto-merge, and what this account may do. Before approving or merging, confirm required checks passed at `readiness.headSha` and pass it as `expectedHeadSha`.",
  parameters: HostTarget,
  success: ReadPullRequestResult,
  failure: PullRequestToolError,
  dependencies: hostDependencies,
})
  .annotate(Tool.Title, "Read pull request")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

const ListReviewThreadsTool = Tool.make("list_review_threads", {
  description: "List a PR's review threads: ids, resolved state, comments.",
  parameters: HostTarget,
  success: ListReviewThreadsResult,
  failure: PullRequestToolError,
  dependencies: hostDependencies,
})
  .annotate(Tool.Title, "List review threads")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

const CommentOnPullRequestTool = Tool.make("comment_on_pull_request", {
  description: "Post a top-level PR comment. For a review thread, use `reply_to_review_thread`.",
  parameters: Schema.Struct({
    ...HostTarget.fields,
    body: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(65_536)).annotate({
      description: "Markdown.",
    }),
  }),
  success: PullRequestWriteResult,
  failure: PullRequestToolError,
  dependencies: hostDependencies,
})
  .annotate(Tool.Title, "Comment on pull request")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

const ReviewPullRequestTool = Tool.make("review_pull_request", {
  description:
    "Submit a review: approve, request-changes, or comment (the last two need `body`). Pass `expectedHeadSha`. Allowed verdicts: `readiness.allowed.verdicts` from `read_pull_request`.",
  parameters: Schema.Struct({
    ...HostTarget.fields,
    verdict: PullRequestReviewVerdict,
    body: Schema.optional(
      Schema.String.check(Schema.isMaxLength(65_536)).annotate({
        description: "The review's summary, in markdown. Optional for approve.",
      }),
    ),
    expectedHeadSha: ExpectedHeadSha,
  }),
  success: PullRequestWriteResult,
  failure: PullRequestToolError,
  dependencies: hostDependencies,
})
  .annotate(Tool.Title, "Review pull request")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

const ReviewThreadId = TrimmedNonEmptyString.annotate({
  description: "The review thread's id, from list_review_threads.",
});

const ReplyToReviewThreadTool = Tool.make("reply_to_review_thread", {
  description: "Reply inside a pull request review thread.",
  parameters: Schema.Struct({
    ...HostTarget.fields,
    reviewThreadId: ReviewThreadId,
    body: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(65_536)).annotate({
      description: "Markdown.",
    }),
  }),
  success: PullRequestWriteResult,
  failure: PullRequestToolError,
  dependencies: hostDependencies,
})
  .annotate(Tool.Title, "Reply to review thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

const ResolveReviewThreadTool = Tool.make("resolve_review_thread", {
  description: "Resolve a PR review thread, or reopen it with `resolved:false`.",
  parameters: Schema.Struct({
    ...HostTarget.fields,
    reviewThreadId: ReviewThreadId,
    resolved: Schema.optional(
      Schema.Boolean.annotate({ description: "Defaults to true. False reopens the thread." }),
    ),
  }),
  success: PullRequestWriteResult,
  failure: PullRequestToolError,
  dependencies: hostDependencies,
})
  .annotate(Tool.Title, "Resolve review thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

/** The actions an agent may run. Stack, revert and workflow approval stay with the user. */
export const AgentPullRequestAction = Schema.Literals([
  "merge",
  "enable-auto-merge",
  "disable-auto-merge",
  "close",
  "reopen",
  "ready",
  "draft",
  "update-branch",
]);

const RunPullRequestActionTool = Tool.make("run_pull_request_action", {
  description:
    "Run a PR action. Merge only with the user's authorization, and pass `expectedHeadSha` with merge and enable-auto-merge. Allowed actions: `readiness.allowed.actions` from `read_pull_request`.",
  parameters: Schema.Struct({
    ...HostTarget.fields,
    action: AgentPullRequestAction,
    mergeMethod: Schema.optional(
      PullRequestMergeMethod.annotate({
        description:
          "Strategy for merge and enable-auto-merge. Omit for the host's default; it must be in readiness.allowed.mergeMethods.",
      }),
    ),
    expectedHeadSha: ExpectedHeadSha,
  }),
  success: PullRequestWriteResult,
  failure: PullRequestToolError,
  dependencies: hostDependencies,
})
  .annotate(Tool.Title, "Run pull request action")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

export const PullRequestsToolkit = Toolkit.make(
  LinkPullRequestTool,
  UnlinkPullRequestTool,
  ListThreadPullRequestsTool,
  WatchPullRequestTool,
  UnwatchPullRequestTool,
  WritePullRequestGuidesTool,
  ReadPullRequestGuideTool,
  ReadPullRequestTool,
  ListReviewThreadsTool,
  CommentOnPullRequestTool,
  ReviewPullRequestTool,
  ReplyToReviewThreadTool,
  ResolveReviewThreadTool,
  RunPullRequestActionTool,
);
