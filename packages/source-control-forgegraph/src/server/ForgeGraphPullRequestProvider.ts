import {
  SourceControlProviderKind,
  type PullRequestCapabilities,
  type PullRequestMergeMethod,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { randomUuidV4 } from "@t3tools/provider-core/server/randomUuid";
import {
  PullRequestProviderError,
  type ProviderRepositoryRef,
  type PullRequestProviderApi,
} from "@t3tools/source-control-core/server/PullRequestProvider";

import { definition } from "../client/definition.ts";
import * as ForgeGraphApi from "./ForgeGraphApi.ts";
import { forgeGraphRepositoryPath } from "./forgeGraphHosts.ts";
import * as Json from "./forgeGraphJson.ts";
import * as ForgeGraphLookups from "./forgeGraphLookups.ts";

const KIND = SourceControlProviderKind.make("forgegraph");

/**
 * What ForgeGraph can do at most. A server without review threads reports no thread to reply to
 * or resolve, and one without native merge-when-green offers it only on the Forgejo backend, both
 * through each pull request's own permissions. Diffs wait on FORGE-147, whose routes answer 404.
 */
const CAPABILITIES: PullRequestCapabilities = {
  diff: false,
  comment: true,
  actions: [...definition.changeRequestActions],
  mergeMethods: ["merge", "squash", "rebase"],
  search: false,
  reactions: false,
  labels: false,
  review: {
    // Line comments need a diff to be placed on, which waits on FORGE-147.
    inlineComment: false,
    reply: true,
    resolve: true,
    verdicts: ["approve", "request-changes", "comment"],
  },
  reviewers: { request: false, listCandidates: false },
  edit: { changeRequest: false, comment: false },
};

const HEAD_SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;
const COMMENT_ID = /^[A-Za-z0-9_-]{1,128}$/u;
/** How long a server that answered 404 for mergeability is not asked again. */
const MERGEABILITY_RETRY_MS = 5 * 60_000;

type PullRef = ProviderRepositoryRef & { readonly number: number };

/** The sentence a refusal is shown with, for the codes ForgeGraph's merge and review routes use. */
function refusal(error: ForgeGraphApi.ForgeGraphApiError): string {
  switch (error.code) {
    case "stale_head":
      return "The pull request moved since it was read. Refresh it and try again.";
    case "merge_in_flight":
      return "ForgeGraph is already merging this pull request.";
    case "unsupported_strategy":
      return "This repository's ForgeGraph backend does not merge with that strategy.";
    case "running":
      return "ForgeGraph is already running this merge, so it can no longer be cancelled.";
    default:
      return error.status === 409 && error.operation === "submitReview"
        ? "The pull request moved since it was read. Refresh it and review the new head."
        : error.detail;
  }
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const lookups = yield* ForgeGraphLookups.make;
  const { api } = lookups;

  const failure = (operation: string, detail: string) =>
    new PullRequestProviderError({ provider: KIND, operation, reason: "failed", detail });

  const fromApi = (error: ForgeGraphApi.ForgeGraphApiError) =>
    new PullRequestProviderError({
      provider: KIND,
      operation: error.operation,
      reason: error.reason,
      detail: refusal(error),
      cause: error,
    });

  /** The repository a reference names, refused before anything is sent if it is not owner/repo. */
  const repositoryOf = (
    operation: string,
    input: ProviderRepositoryRef,
  ): Effect.Effect<string, PullRequestProviderError> =>
    forgeGraphRepositoryPath(input.repository) === input.repository
      ? Effect.succeed(input.repository)
      : Effect.fail(failure(operation, "ForgeGraph repositories are named owner/repo."));

  const readPull = (operation: string, input: PullRef) =>
    repositoryOf(operation, input).pipe(
      Effect.flatMap((repository) =>
        lookups.pull(operation, repository, input.number).pipe(Effect.mapError(fromApi)),
      ),
    );

  const post = (operation: string, path: string, body: unknown) =>
    api
      .request({ operation, method: "POST", path, body })
      .pipe(Effect.asVoid, Effect.mapError(fromApi));

  const checksFor = (operation: string, input: PullRef, pull: Json.NumberedPull) =>
    lookups.gate(operation, input.repository, pull.headSha).pipe(Effect.mapError(fromApi));

  const merge = Effect.fn("ForgeGraphPullRequestProvider.merge")(function* (
    input: PullRef & { readonly mergeMethod?: PullRequestMergeMethod; readonly whenGreen: boolean },
  ) {
    const operation = input.whenGreen ? "enable-auto-merge" : "merge";
    const pull = yield* readPull(operation, input);
    if (pull.status === "merged") return;
    // An older server ignores `whenGreen` on a native pull request and merges at once.
    if (input.whenGreen && !Json.canMergeWhenGreen(pull))
      return yield* failure(
        operation,
        "This ForgeGraph server cannot merge native pull requests when green yet.",
      );
    if ((input.mergeMethod ?? "merge") === "rebase" && pull.prBackend === "native")
      return yield* failure(operation, "Native ForgeGraph pull requests do not rebase-merge.");
    // Pinned to the head that was read, so a push in between is refused rather than merged unseen.
    yield* post(operation, `/fg/prs/${encodeURIComponent(pull.id)}/merge`, {
      strategy: input.mergeMethod ?? "merge",
      whenGreen: input.whenGreen,
      ...(pull.headSha && HEAD_SHA.test(pull.headSha) ? { expectedHeadSha: pull.headSha } : {}),
    });
  });

  // A server without the route answers 404 for every pull request, so it is not asked for a while.
  let mergeabilityMissingAt: number | null = null;
  const readMergeability = Effect.fn("ForgeGraphPullRequestProvider.readMergeability")(function* (
    pull: Json.NumberedPull,
  ) {
    const now = yield* Clock.currentTimeMillis;
    if (mergeabilityMissingAt !== null && now - mergeabilityMissingAt < MERGEABILITY_RETRY_MS)
      return null;
    return yield* lookups
      .read(
        {
          operation: "getChangeRequest",
          path: `/fg/prs/${encodeURIComponent(pull.id)}/mergeability`,
        },
        Json.ForgeGraphMergeability,
      )
      .pipe(
        Effect.tap(() => Effect.sync(() => (mergeabilityMissingAt = null))),
        Effect.catchTags({
          ForgeGraphApiError: (error) => {
            if (error.reason === "unauthenticated" || error.reason === "rate-limited")
              return Effect.fail(fromApi(error));
            if (error.status === 404) mergeabilityMissingAt = now;
            // Mergeability decorates the detail; without it the detail still stands.
            return Effect.succeed(null);
          },
        }),
      );
  });

  const cancelAutoMerge = Effect.fn("ForgeGraphPullRequestProvider.cancelAutoMerge")(function* (
    input: PullRef,
  ) {
    const operation = "disable-auto-merge";
    const pull = yield* readPull(operation, input);
    yield* lookups
      .read(
        {
          operation,
          method: "DELETE",
          path: `/fg/prs/${encodeURIComponent(pull.id)}/merge`,
        },
        Json.ForgeGraphMergeCancelled,
      )
      .pipe(
        // The pull request was just read, so a 404 is a server without the route.
        Effect.mapError((error) =>
          error.status === 404
            ? failure(operation, "This ForgeGraph server cannot cancel a merge when green yet.")
            : fromApi(error),
        ),
      );
    // `cancelled: false` means nothing was pending, which is the state asked for.
  });

  /** A thread root's or reply's id as ForgeGraph writes it, refused before it reaches a path. */
  const commentId = (operation: string, id: string) =>
    COMMENT_ID.test(id)
      ? Effect.succeed(id)
      : Effect.fail(failure(operation, "ForgeGraph comment ids are opaque slugs."));

  /** Refuses thread writes on a server without threads, which would post a loose comment instead. */
  const readThreadedPull = (operation: string, input: PullRef) =>
    readPull(operation, input).pipe(
      Effect.filterOrFail(Json.hasThreads, () =>
        failure(operation, "This ForgeGraph server does not support review threads yet."),
      ),
    );

  const provider: PullRequestProviderApi = {
    kind: KIND,
    capabilities: CAPABILITIES,
    getViewer: () =>
      lookups.read({ operation: "getViewer", path: "/fg/whoami" }, Json.ForgeGraphWhoami).pipe(
        Effect.mapError(fromApi),
        Effect.flatMap((whoami) =>
          whoami.user
            ? Effect.succeed(whoami.user)
            : Effect.fail(failure("getViewer", "ForgeGraph's token belongs to no named user.")),
        ),
      ),
    listChangeRequests: Effect.fn("ForgeGraphPullRequestProvider.listChangeRequests")(
      function* (input) {
        const operation = "listChangeRequests";
        const repository = yield* repositoryOf(operation, input);
        const page = yield* lookups
          .listPulls(operation, repository, input.state, Math.max(1, input.limit))
          .pipe(Effect.mapError(fromApi));
        const viewer = input.viewer.toLowerCase();
        const server = yield* api.server;
        return {
          items: page.pulls
            // ForgeGraph names authors by display name, so this narrows as far as it can.
            .filter(
              (pull) => input.involvement !== "authored" || pull.author?.toLowerCase() === viewer,
            )
            .map((pull) => Json.toChangeRequest(pull, server)),
          truncated: page.truncated,
          continues: false,
        };
      },
    ),
    getChangeRequestSummary: Effect.fn("ForgeGraphPullRequestProvider.getChangeRequestSummary")(
      function* (input) {
        const pull = yield* readPull("getChangeRequestSummary", input);
        return Json.toChangeRequest(pull, yield* api.server);
      },
    ),
    getChangeRequestChecks: Effect.fn("ForgeGraphPullRequestProvider.getChangeRequestChecks")(
      function* (input) {
        const pull = yield* readPull("getChangeRequestChecks", input);
        const gate = yield* checksFor("getChangeRequestChecks", input, pull);
        return { state: Json.stateOf(pull), checks: Json.toChecks(gate, yield* api.server) };
      },
    ),
    getChangeRequest: Effect.fn("ForgeGraphPullRequestProvider.getChangeRequest")(
      function* (input) {
        const pull = yield* readPull("getChangeRequest", input);
        const [gate, mergeability] = yield* Effect.all(
          [checksFor("getChangeRequest", input, pull), readMergeability(pull)],
          { concurrency: 2 },
        );
        const server = yield* api.server;
        const autoMerge =
          mergeability?.autoMerge !== undefined ? mergeability.autoMerge : pull.autoMerge;
        const checksState = Json.toChecksState(gate, pull);
        const state = Json.stateOf(pull);
        return {
          ...Json.toChangeRequest(pull, server),
          headSha: pull.headSha ?? null,
          body: pull.body ?? "",
          changedFiles: 0,
          mergedAt: state === "merged" ? Json.lastActivityAt(pull) : null,
          closedAt: state === "open" ? null : Json.lastActivityAt(pull),
          reviewers: [...new Set((pull.reviews ?? []).map((review) => review.author))]
            .filter((author) => author !== "unknown")
            .map((login) => ({ login, name: null, avatarUrl: null })),
          checks: Json.toChecks(gate, server),
          ...(checksState === null ? {} : { checksState }),
          ...(mergeability === null ? {} : { mergeability: mergeability.mergeable }),
          // Absent where the server cannot say whether a merge-when-green request is pending.
          ...(autoMerge === undefined
            ? {}
            : {
                autoMergeEnabled: autoMerge !== null,
                ...(autoMerge?.strategy === "merge" ||
                autoMerge?.strategy === "squash" ||
                autoMerge?.strategy === "rebase"
                  ? { autoMergeMethod: autoMerge.strategy }
                  : {}),
              }),
          mergeCapabilities: Json.toMergeCapabilities(pull, mergeability),
          viewerPermissions: Json.toViewerPermissions(
            autoMerge === undefined ? pull : { ...pull, autoMerge },
          ),
        };
      },
    ),
    getChangeRequestActivity: (input) =>
      readPull("getChangeRequestActivity", input).pipe(Effect.map(Json.toActivity)),
    getViewerPermissions: (input) =>
      readPull("getViewerPermissions", input).pipe(Effect.map(Json.toViewerPermissions)),
    getDiff: () =>
      Effect.fail(failure("getDiff", "ForgeGraph does not serve pull request diffs yet.")),
    runAction: Effect.fn("ForgeGraphPullRequestProvider.runAction")(function* (input) {
      switch (input.action) {
        case "merge":
          return yield* merge({ ...input, whenGreen: false });
        case "enable-auto-merge":
          return yield* merge({ ...input, whenGreen: true });
        case "disable-auto-merge":
          return yield* cancelAutoMerge(input);
        case "close": {
          const pull = yield* readPull("close", input);
          if (Json.stateOf(pull) !== "open") return;
          return yield* post("close", `/fg/prs/${encodeURIComponent(pull.id)}/close`, {});
        }
        default:
          return yield* failure(
            input.action,
            `ForgeGraph cannot ${input.action} from T3 Code yet.`,
          );
      }
    }),
    comment: Effect.fn("ForgeGraphPullRequestProvider.comment")(function* (input) {
      const pull = yield* readPull("comment", input);
      yield* post("comment", `/fg/prs/${encodeURIComponent(pull.id)}/comments`, {
        body: input.body,
      });
    }),
    submitReview: Effect.fn("ForgeGraphPullRequestProvider.submitReview")(function* (input) {
      if (input.comments.length > 0)
        return yield* failure(
          "submitReview",
          "ForgeGraph line comments in reviews are not supported yet.",
        );
      const pull = yield* readPull("submitReview", input);
      if (!pull.headSha)
        return yield* failure(
          "submitReview",
          "ForgeGraph has not reported the pull request's head.",
        );
      // Pinned to the head that was read: ForgeGraph refuses the verdict if the branch moved.
      yield* post("submitReview", `/fg/prs/${encodeURIComponent(pull.id)}/review`, {
        expectedHeadSha: pull.headSha,
        idempotencyKey: yield* randomUuidV4,
        verdict: Json.REVIEW_VERDICT[input.verdict],
        ...(input.body.length === 0 ? {} : { body: input.body }),
      });
    }),
    listReviewerCandidates: () =>
      Effect.fail(
        failure("listReviewerCandidates", "ForgeGraph reviewer requests are not supported."),
      ),
    setReviewerRequest: () =>
      Effect.fail(failure("setReviewerRequest", "ForgeGraph reviewer requests are not supported.")),
    // Threads are one level deep; a reply takes its root's anchor, so only the root is named.
    replyToThread: Effect.fn("ForgeGraphPullRequestProvider.replyToThread")(function* (input) {
      const parentId = yield* commentId("replyToThread", input.threadId);
      const pull = yield* readThreadedPull("replyToThread", input);
      yield* post("replyToThread", `/fg/prs/${encodeURIComponent(pull.id)}/comments`, {
        body: input.body,
        parentId,
      });
    }),
    setReaction: () =>
      Effect.fail(failure("setReaction", "ForgeGraph reactions are not supported.")),
    setThreadResolution: Effect.fn("ForgeGraphPullRequestProvider.setThreadResolution")(
      function* (input) {
        const id = yield* commentId("setThreadResolution", input.threadId);
        const pull = yield* readThreadedPull("setThreadResolution", input);
        yield* post(
          "setThreadResolution",
          `/fg/prs/${encodeURIComponent(pull.id)}/comments/${id}/resolve`,
          { resolved: input.resolved },
        );
      },
    ),
  };
  return provider;
});
