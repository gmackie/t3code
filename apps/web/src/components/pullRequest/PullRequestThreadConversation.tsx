import type {
  EnvironmentId,
  PullRequestDetailView,
  PullRequestRef,
  PullRequestReviewThread,
  PullRequestThreadCommentsResult,
} from "@t3tools/contracts";
import { useState } from "react";

import { pullRequestEnvironment } from "~/state/pullRequests";
import { useAtomCommand } from "~/state/use-atom-command";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  canEditPullRequestComment,
  canResolvePullRequestThread,
} from "@t3tools/client-runtime/pull-request-editing";
import { ReviewThreadCard } from "./PullRequestReviewAnnotation";

/**
 * A review conversation with its own commands: reply, resolve, rewrite a remark, read further.
 * For surfaces that list threads without a diff to pin them to, such as the Summary tab of a host
 * that serves no diffs; the Code tab wires the same card to its line annotations itself.
 */
export function PullRequestThreadConversation({
  thread,
  detail,
  environmentId,
  reference,
  onRefresh,
  fixPending,
  fixLabel,
  onFix,
}: {
  thread: PullRequestReviewThread;
  detail: PullRequestDetailView;
  environmentId: EnvironmentId;
  reference: PullRequestRef;
  onRefresh: () => void;
  fixPending?: boolean;
  fixLabel?: string;
  onFix?: () => void;
}) {
  const replyToThread = useAtomCommand(pullRequestEnvironment.replyToThread, {
    reportFailure: false,
  });
  const setThreadResolution = useAtomCommand(pullRequestEnvironment.setThreadResolution, {
    reportFailure: false,
  });
  const updateComment = useAtomCommand(pullRequestEnvironment.updateComment, {
    reportFailure: false,
  });
  const loadThreadComments = useAtomCommand(pullRequestEnvironment.threadComments, {
    reportFailure: false,
  });
  const [pending, setPending] = useState(false);
  const hostReview = detail.capabilities.review;
  const viewer = detail.viewerPermissions;

  const run = async (
    failureTitle: string,
    command: () => Promise<{ readonly _tag: string }>,
  ): Promise<boolean> => {
    if (pending) return false;
    setPending(true);
    const result = await command();
    setPending(false);
    if (result._tag === "Failure") {
      toastManager.add({ type: "error", title: failureTitle });
      return false;
    }
    onRefresh();
    return true;
  };

  // Off the diff, the card cannot sit on its line, so it says which one it is about.
  const location = `${thread.path}${thread.line === null ? "" : `:${thread.line}`}`;
  return (
    <div className="space-y-1.5">
      <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <Tooltip>
          <TooltipTrigger render={<span className="truncate font-mono" />}>
            {location}
          </TooltipTrigger>
          <TooltipPopup>{location}</TooltipPopup>
        </Tooltip>
        {thread.isOutdated ? <span className="shrink-0">Outdated</span> : null}
      </p>
      <ReviewThreadCard
        thread={thread}
        workspaceRoot={detail.workspaceRoot}
        canReply={hostReview.reply && viewer.comment}
        canResolve={
          hostReview.resolve && viewer.resolve && canResolvePullRequestThread(detail, thread)
        }
        canReact={detail.capabilities.reactions === true}
        environmentId={environmentId}
        reference={reference}
        pending={pending}
        {...(fixPending === undefined ? {} : { fixPending })}
        {...(fixLabel === undefined ? {} : { fixLabel })}
        {...(onFix ? { onFix } : {})}
        onLoadMore={async (cursor): Promise<PullRequestThreadCommentsResult | null> => {
          const result = await loadThreadComments({
            environmentId,
            input: { ...reference, threadId: thread.id, cursor },
          });
          if (result._tag === "Failure") {
            toastManager.add({ type: "error", title: "More comments could not be loaded" });
            return null;
          }
          return result.value;
        }}
        onReply={(body) =>
          run("Reply could not be posted", () =>
            replyToThread({ environmentId, input: { ...reference, threadId: thread.id, body } }),
          )
        }
        // A conversation is made of review comments, whatever the host filed them as.
        canEditComment={(comment) =>
          canEditPullRequestComment(detail, {
            author: comment.author,
            kind: "review-comment",
            canEdit: comment.canEdit,
          })
        }
        onEditComment={(commentId, body) =>
          run("The comment could not be saved", () =>
            updateComment({
              environmentId,
              input: { ...reference, commentId, kind: "review-comment", body },
            }),
          )
        }
        onToggleResolved={() =>
          void run("The conversation could not be updated", () =>
            setThreadResolution({
              environmentId,
              input: { ...reference, threadId: thread.id, resolved: !thread.isResolved },
            }),
          )
        }
        onReacted={onRefresh}
      />
    </div>
  );
}
