import {
  SourceControlProviderKind,
  type PullRequestCapabilities,
  type PullRequestMergeMethod,
} from "@t3tools/contracts";
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
 * What today's `/api/fg` supports. Diffs, review threads, and replies wait on FORGE-138; each is
 * switched on here once the server serves it.
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
    inlineComment: false,
    reply: false,
    resolve: false,
    verdicts: ["approve", "request-changes", "comment"],
  },
  reviewers: { request: false, listCandidates: false },
  edit: { changeRequest: false, comment: false },
};

const HEAD_SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u;

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
    if (input.whenGreen && pull.prBackend === "native")
      return yield* failure(
        operation,
        "ForgeGraph cannot merge native pull requests when green yet.",
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
        const gate = yield* checksFor("getChangeRequest", input, pull);
        const server = yield* api.server;
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
          mergeCapabilities: Json.toMergeCapabilities(pull),
          viewerPermissions: Json.toViewerPermissions(pull),
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
    replyToThread: () =>
      Effect.fail(failure("replyToThread", "ForgeGraph review threads are not supported yet.")),
    setReaction: () =>
      Effect.fail(failure("setReaction", "ForgeGraph reactions are not supported.")),
    setThreadResolution: () =>
      Effect.fail(
        failure("setThreadResolution", "ForgeGraph review threads are not supported yet."),
      ),
  };
  return provider;
});
