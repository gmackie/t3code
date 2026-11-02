import type {
  EnvironmentId,
  McpOAuthSignInEvent,
  McpOAuthSignInInput,
  McpOAuthStatus,
  ProjectId,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useRef, useState } from "react";

import { ensureLocalApi } from "../../localApi";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { useEnvironmentHttpBaseUrl } from "../../state/environments";
import { formatEnvironmentQueryError, useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { waitForQuerySettled } from "../../state/waitForQuerySettled";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";

/**
 * Sign-in state and actions for one OAuth server on one environment. The
 * server runs the flow; this opens the provider's page and waits for the
 * stream to report the browser came back.
 */
export function McpOAuthSignIn({
  environmentId,
  projectId,
  server,
  status,
  canManage,
  onChanged,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | null;
  readonly server: string;
  readonly status: McpOAuthStatus | undefined;
  readonly canManage: boolean;
  readonly onChanged: () => void;
}) {
  const httpBaseUrl = useEnvironmentHttpBaseUrl(environmentId);
  const [signIn, setSignIn] = useState<McpOAuthSignInInput | null>(null);
  const abort = useRef<AbortController | null>(null);
  const signInQuery = useEnvironmentQuery(
    signIn ? serverEnvironment.mcpOAuthSignIn({ environmentId, input: signIn }) : null,
  );
  const signOut = useAtomCommand(serverEnvironment.mcpOAuthSignOut, { reportFailure: false });
  const event = signInQuery.data;
  const authorizationUrl = event?.type === "authorize" ? event.authorizationUrl : null;
  const scoped = projectId === null ? {} : { projectId };

  const cancel = () => {
    abort.current?.abort();
    abort.current = null;
    setSignIn(null);
  };

  const start = async () => {
    if (httpBaseUrl === null) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const input = { server, callbackOrigin: new URL(httpBaseUrl).origin, ...scoped };
    setSignIn(input);
    const atom = serverEnvironment.mcpOAuthSignIn({ environmentId, input });
    const wait = <R,>(settle: (value: McpOAuthSignInEvent | null) => R | undefined) =>
      waitForQuerySettled({ registry: appAtomRegistry, atom, settle, signal: controller.signal });

    const url = await wait((value) =>
      value?.type === "authorize" ? value.authorizationUrl : undefined,
    );
    if (url !== undefined)
      void ensureLocalApi()
        .shell.openExternal(url)
        .catch(() => undefined);
    const connected =
      url !== undefined &&
      (await wait((value) => (value?.type === "connected" ? true : undefined)));
    if (controller.signal.aborted) return;
    const result = appAtomRegistry.get(atom);
    abort.current = null;
    setSignIn(null);
    if (connected === true) {
      onChanged();
      toastManager.add({ type: "success", title: `Signed in to ${server}` });
    } else if (AsyncResult.isFailure(result)) {
      toastManager.add({
        type: "error",
        title: "Sign-in failed",
        description: formatEnvironmentQueryError(result.cause),
      });
    }
  };

  if (signIn !== null) {
    return (
      <span className="flex items-center gap-1.5">
        {authorizationUrl ? (
          <a
            className="text-xs text-muted-foreground underline"
            href={authorizationUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open sign-in page
          </a>
        ) : null}
        <Button size="xs" variant="ghost" onClick={cancel}>
          Cancel
        </Button>
      </span>
    );
  }

  const state = status?.status ?? "signed-out";
  return (
    <span className="flex items-center gap-1.5">
      {state === "connected" ? (
        <Badge variant="success" size="sm">
          Signed in
        </Badge>
      ) : state === "needs-auth" ? (
        <Badge variant="warning" size="sm">
          Sign-in expired
        </Badge>
      ) : null}
      {state === "connected" ? (
        <Button
          size="xs"
          variant="ghost"
          disabled={!canManage}
          onClick={() =>
            void signOut({ environmentId, input: { server, ...scoped } }).then(onChanged)
          }
        >
          Sign out
        </Button>
      ) : (
        <Button
          size="xs"
          variant="outline"
          disabled={!canManage || httpBaseUrl === null}
          onClick={() => void start()}
        >
          {state === "needs-auth" ? "Reconnect" : "Sign in"}
        </Button>
      )}
    </span>
  );
}
