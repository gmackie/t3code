import type { EnvironmentId, McpOAuthSignInEvent, ProjectId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import * as WebBrowser from "expo-web-browser";
import { useCallback } from "react";

import { appAtomRegistry } from "../../state/atom-registry";
import { serverEnvironment } from "../../state/server";
import { usePreparedConnection } from "../../state/session";

export type McpOAuthSignInOutcome =
  | { readonly status: "connected" }
  | { readonly status: "cancelled" }
  | { readonly status: "failed"; readonly message: string };

/**
 * Signs the environment in to an OAuth MCP server. The server runs the flow;
 * this opens the provider's page in an in-app browser and closes it when the
 * server reports the browser came back. Closing the browser first cancels.
 */
export function signInToMcpServer(input: {
  readonly environmentId: EnvironmentId;
  readonly httpBaseUrl: string;
  readonly server: string;
  readonly projectId: ProjectId | null;
}): Promise<McpOAuthSignInOutcome> {
  const atom = serverEnvironment.mcpOAuthSignIn({
    environmentId: input.environmentId,
    input: {
      server: input.server,
      callbackOrigin: new URL(input.httpBaseUrl).origin,
      ...(input.projectId === null ? {} : { projectId: input.projectId }),
    },
  });
  return new Promise((resolve) => {
    let done = false;
    let opened = false;
    let unsubscribe: (() => void) | undefined;
    const finish = (outcome: McpOAuthSignInOutcome) => {
      if (done) return;
      done = true;
      // Unsubscribing unmounts the stream, which ends a sign-in still waiting.
      unsubscribe?.();
      resolve(outcome);
    };
    const check = (result: AsyncResult.AsyncResult<McpOAuthSignInEvent, unknown>) => {
      if (AsyncResult.isFailure(result)) {
        const error = Cause.squash(result.cause);
        return finish({
          status: "failed",
          message: error instanceof Error ? error.message : "The sign-in failed.",
        });
      }
      const event = Option.getOrNull(AsyncResult.value(result));
      if (event?.type === "connected") {
        WebBrowser.dismissBrowser();
        return finish({ status: "connected" });
      }
      if (event?.type === "authorize" && !opened) {
        opened = true;
        void WebBrowser.openBrowserAsync(event.authorizationUrl).then(() => {
          // The browser closed; give a just-landed `connected` a moment to arrive.
          setTimeout(() => finish({ status: "cancelled" }), 1_000);
        });
      }
    };
    unsubscribe = appAtomRegistry.subscribe(atom, check, { immediate: true });
    if (done) unsubscribe();
  });
}

/** `signInToMcpServer` bound to an environment's current connection; null until it has one. */
export function useMcpOAuthSignIn(environmentId: EnvironmentId) {
  const connection = usePreparedConnection(environmentId);
  const httpBaseUrl = Option.isSome(connection) ? connection.value.httpBaseUrl : null;
  const signIn = useCallback(
    (server: string, projectId: ProjectId | null) =>
      httpBaseUrl === null
        ? Promise.resolve<McpOAuthSignInOutcome>({
            status: "failed",
            message: "This environment isn't connected.",
          })
        : signInToMcpServer({ environmentId, httpBaseUrl, server, projectId }),
    [environmentId, httpBaseUrl],
  );
  return httpBaseUrl === null ? null : signIn;
}
