import type { EnvironmentId, McpOAuthSignInEvent, ProjectId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";

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
 * server reports the browser came back. Android reports opening a browser
 * immediately; only an actual close cancels. Unmounting ends a pending flow.
 */
export function signInToMcpServer(input: {
  readonly environmentId: EnvironmentId;
  readonly httpBaseUrl: string;
  readonly server: string;
  readonly projectId: ProjectId | null;
  readonly signal?: AbortSignal;
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
    if (input.signal?.aborted) {
      resolve({ status: "cancelled" });
      return;
    }
    let done = false;
    let opened = false;
    let unsubscribe: (() => void) | undefined;
    let browserListener: { remove: () => void } | undefined;
    let cancelTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (outcome: McpOAuthSignInOutcome) => {
      if (done) return;
      done = true;
      clearTimeout(cancelTimer);
      browserListener?.remove();
      input.signal?.removeEventListener("abort", abort);
      // Unsubscribing unmounts the stream, which ends a sign-in still waiting.
      unsubscribe?.();
      resolve(outcome);
    };
    const abort = () => finish({ status: "cancelled" });
    const browserClosed = () => {
      if (done) return;
      clearTimeout(cancelTimer);
      // Let the server's completion receipt arrive when the browser returns to the app.
      cancelTimer = setTimeout(() => finish({ status: "cancelled" }), 1_000);
    };
    input.signal?.addEventListener("abort", abort, { once: true });
    const check = (result: AsyncResult.AsyncResult<McpOAuthSignInEvent, unknown>) => {
      if (done) return;
      if (AsyncResult.isFailure(result)) {
        const error = Cause.squash(result.cause);
        return finish({
          status: "failed",
          message: error instanceof Error ? error.message : "The sign-in failed.",
        });
      }
      const event = Option.getOrNull(AsyncResult.value(result));
      if (event?.type === "connected") {
        finish({ status: "connected" });
        // Android cannot dismiss a Custom Tab; a failed dismissal must not lose the receipt.
        void WebBrowser.dismissBrowser()?.catch(() => undefined);
        return;
      }
      if (event?.type === "authorize" && !opened) {
        opened = true;
        if (Platform.OS === "android") {
          let backgrounded = false;
          browserListener = AppState.addEventListener("change", (state) => {
            if (state !== "active") backgrounded = true;
            else if (backgrounded) browserClosed();
          });
        }
        void WebBrowser.openBrowserAsync(event.authorizationUrl).then(
          (browser) => {
            if (done || browser.type === "opened") return;
            browserClosed();
          },
          (error: unknown) =>
            finish({
              status: "failed",
              message:
                error instanceof Error ? error.message : "The sign-in page could not be opened.",
            }),
        );
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
  const pending = useRef<AbortController | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- release the pending OAuth stream when its screen unmounts
  useEffect(() => () => pending.current?.abort(), []);
  const signIn = useCallback(
    (server: string, projectId: ProjectId | null) => {
      pending.current?.abort();
      if (httpBaseUrl === null) {
        return Promise.resolve<McpOAuthSignInOutcome>({
          status: "failed",
          message: "This environment isn't connected.",
        });
      }
      const controller = new AbortController();
      pending.current = controller;
      return signInToMcpServer({
        environmentId,
        httpBaseUrl,
        server,
        projectId,
        signal: controller.signal,
      });
    },
    [environmentId, httpBaseUrl],
  );
  return httpBaseUrl === null ? null : signIn;
}
