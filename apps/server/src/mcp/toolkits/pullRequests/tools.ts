import {
  McpCapabilityUnavailableError,
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

const REGISTER_EVERY_PR =
  "Register every pull request you open for this thread, including each layer of a stack, right after creating it.";

/**
 * Either the pull request's URL or its repository and number. Both forms
 * resolve to the same host-level identity, so the agent can pass whichever
 * the host CLI handed back.
 */
export const PullRequestTargetInput = Schema.Struct({
  threadId: Schema.optional(
    ThreadId.annotate({
      description: "Thread to act on. Omit for this thread.",
    }),
  ),
  url: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description:
        "The pull request's web URL, for example https://github.com/owner/repo/pull/123. Preferred when you have it; host, repository and number are read from it.",
    }),
  ),
  repository: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description:
        "Repository path below the host, for example owner/repo. Required with number when url is omitted.",
    }),
  ),
  number: Schema.optional(
    PositiveInt.annotate({
      description: "Pull request number. Required with repository when url is omitted.",
    }),
  ),
  host: Schema.optional(
    TrimmedNonEmptyString.annotate({
      description:
        "Host the repository lives on, for example github.com. Defaults to the host of this thread's project.",
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
  alreadyLinked: Schema.Boolean.annotate({
    description: "True when the pull request was linked to this thread before the call.",
  }),
});
export type LinkPullRequestResult = typeof LinkPullRequestResult.Type;

export const UnlinkPullRequestResult = Schema.Struct({
  host: Schema.String,
  repository: Schema.String,
  number: Schema.Int,
  wasLinked: Schema.Boolean.annotate({
    description: "False when the pull request was not linked to this thread to begin with.",
  }),
});
export type UnlinkPullRequestResult = typeof UnlinkPullRequestResult.Type;

export const WatchPullRequestResult = Schema.Struct({
  ...PullRequestIdentity,
  watching: Schema.Boolean.annotate({
    description: "Whether T3 Code now watches the pull request for this thread.",
  }),
  wasWatching: Schema.Boolean.annotate({
    description: "Whether it was already watched before the call.",
  }),
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
      /** 1-based, bottom of the stack first. */
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
      /** Bottom to top. */
      numbers: Schema.Array(Schema.Int),
    }),
  ),
});
export type ListThreadPullRequestsResult = typeof ListThreadPullRequestsResult.Type;

const LinkPullRequestTool = Tool.make("link_pull_request", {
  description: `${REGISTER_EVERY_PR} Links a pull request to this thread so T3 Code tracks it, shows its status beside the thread, and settles the thread when it merges. Pass the URL, or repository plus number. Linking an already-linked pull request succeeds with alreadyLinked=true.`,
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
    "Remove a pull request link from this thread, for example after closing a pull request you opened by mistake. Pass the URL, or repository plus number. Unlinking a pull request that is not linked succeeds with wasLinked=false.",
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
  description: `List the pull requests linked to a thread (omit threadId for this thread) with their last known host state, and how they chain into stacks (bottom to top). ${REGISTER_EVERY_PR}`,
  parameters: Schema.Struct({
    threadId: Schema.optional(
      ThreadId.annotate({ description: "Thread to list. Omit for this thread." }),
    ),
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
    "Have T3 Code watch an open pull request for this thread, linking it first if needed. T3 Code checks it every two minutes and wakes you with a message when a check fails, the required checks pass, someone else comments or reviews, or the branch starts to conflict with its base. Use this to monitor or babysit a pull request instead of polling, sleeping, or running a watcher. Only comments posted after this call wake you, so handle the existing ones first, then end your turn. A wake is news, not a merge decision: check readiness yourself before merging. While T3 Code watches, the thread stays in the user's Working list, not their inbox. When you hand the work back to the user, call unwatch_pull_request first so the thread returns to their inbox. Watching ends when the pull request merges or closes, when its thread settles or is archived, when T3 Code fails to read it 8 times in a row (a host rate limit only delays it), when the user stops this thread, or when you call unwatch_pull_request. Unsettle the thread before starting a new watch. A subagent cannot watch: its parent thread owns the pull request.",
  parameters: PullRequestTargetInput,
  success: WatchPullRequestResult,
  failure: PullRequestToolError,
  dependencies,
})
  .annotate(Tool.Title, "Watch pull request")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const UnwatchPullRequestTool = Tool.make("unwatch_pull_request", {
  description:
    "Stop T3 Code from watching a pull request for this thread. The pull request stays linked. Pass the URL, or repository plus number.",
  parameters: PullRequestTargetInput,
  success: WatchPullRequestResult,
  failure: PullRequestToolError,
  dependencies,
})
  .annotate(Tool.Title, "Stop watching pull request")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

/** A pull request to write or read a guide for, by URL or by repository and number. */
const GuideTarget = Schema.Struct({
  url: PullRequestTargetInput.fields.url,
  repository: PullRequestTargetInput.fields.repository,
  number: PullRequestTargetInput.fields.number,
  host: PullRequestTargetInput.fields.host,
});

const GuideOutcome = Schema.Struct({
  ...PullRequestIdentity,
  outcome: Schema.Literals(["started", "running", "failed"]).annotate({
    description:
      "started: a run began. running: one was already going for this head and the call joined it. failed: this pull request could not be guided; see detail.",
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
    description:
      "True when the guide was written for an earlier head than the pull request has now.",
  }),
});
export type ReadPullRequestGuideResult = typeof ReadPullRequestGuideResult.Type;

const WritePullRequestGuidesTool = Tool.make("write_pull_request_guides", {
  description:
    "Write review guides for up to 20 pull requests, the tour a maintainer reads in a pull request's Guide tab. Each run reads its change in a temporary checkout and takes minutes, so this returns once the runs are under way; read a guide with read_pull_request_guide to see when it is written. A guide for the same head that is already running is joined, not restarted; a pull request whose guide is current is written again. Each pull request is read through the project in this environment whose checkout has that repository. Fails while review guides are off on this server.",
  parameters: Schema.Struct({
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
    "Read a pull request's stored review guide and its run: run.Running while one is being written, run.Failed with the reason when the last one failed, guide null when none was written. stale is true after a push the guide has not caught up with. Never starts a run.",
  parameters: GuideTarget,
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
    "Read whether a pull request is ready to approve or merge, fresh from its host: state, branches, head commit, mergeability, checks on that head (with which are required), a standing auto-merge, and what this account may do (allowed). Before approving or merging, confirm every required check passed at readiness.headSha, then pass that headSha as expectedHeadSha. Review threads are read with list_review_threads.",
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
  description:
    "List a pull request's review threads with their ids, resolved state, and comments, for reply_to_review_thread and resolve_review_thread.",
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
  description:
    "Post a top-level comment on a pull request's conversation. To answer a review thread, use reply_to_review_thread instead.",
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
    "Submit a review: approve, request-changes, or comment. A request-changes or comment review needs a body. Pass expectedHeadSha so the verdict lands on the commit you checked. Refused when the host or this account cannot give that verdict; read_pull_request's readiness.allowed.verdicts says which it can.",
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
  description:
    "Mark a pull request review thread resolved, or unresolved again with resolved=false.",
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
    "Run an action on a pull request: merge now, enable-auto-merge (the host merges once its required checks and approvals pass), disable-auto-merge, close, reopen, ready, draft, or update-branch. Only merge with the user's authorization. Pass expectedHeadSha with merge and enable-auto-merge so a push you have not checked is never merged. Refused when the host or this account cannot take the action; read_pull_request's readiness.allowed.actions says which it can.",
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
