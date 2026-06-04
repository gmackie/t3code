import { GitRunStackedActionInput, type GitManagerServiceError } from "@t3tools/contracts";
import { Data, Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { ServerAuth } from "../auth/Services/ServerAuth.ts";
import { respondToAuthError } from "../auth/http.ts";
import { GitManager } from "./Services/GitManager.ts";

class GitHttpError extends Data.TaggedError("GitHttpError")<{
  readonly message: string;
  readonly status: number;
}> {}

const respondToGitHttpError = (error: GitHttpError | GitManagerServiceError | unknown) => {
  const status = error instanceof GitHttpError ? error.status : 400;
  const message = error instanceof Error ? error.message : "Failed to run git action.";
  return Effect.succeed(HttpServerResponse.jsonUnsafe({ error: message }, { status }));
};

const authenticateOwnerSession = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const serverAuth = yield* ServerAuth;
  const session = yield* serverAuth.authenticateHttpRequest(request);
  if (session.role !== "owner") {
    return yield* new GitHttpError({
      message: "Only owner sessions can run git actions.",
      status: 403,
    });
  }
  return session;
});

export const gitRunStackedActionRouteLayer = HttpRouter.add(
  "POST",
  "/api/git/run-stacked-action",
  Effect.gen(function* () {
    yield* authenticateOwnerSession;
    const gitManager = yield* GitManager;
    const input = yield* HttpServerRequest.schemaBodyJson(GitRunStackedActionInput);
    const result = yield* gitManager.runStackedAction(input);
    return HttpServerResponse.jsonUnsafe(result, { status: 200 });
  }).pipe(Effect.catchTag("AuthError", respondToAuthError), Effect.catch(respondToGitHttpError)),
);
