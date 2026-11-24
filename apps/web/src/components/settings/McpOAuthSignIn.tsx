import { T, msg, useMessages } from "gt-react";
import type {
  EnvironmentId,
  McpOAuthSignInEvent,
  McpOAuthSignInInput,
  McpOAuthStatus,
  ProjectId,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useRef, useState } from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
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
  const m = useMessages();

  const { copyToClipboard } = useCopyToClipboard({
    timeout: 1500,
    target: {
      target: "sign-in code",
      unavailableMessage: msg("Clipboard API is unavailable while copying sign-in code."),
      failureMessage: msg("Failed to copy sign-in code to the clipboard."),
    },
  });
  const httpBaseUrl = useEnvironmentHttpBaseUrl(environmentId);
  const [signIn, setSignIn] = useState<McpOAuthSignInInput | null>(null);
  const abort = useRef<AbortController | null>(null);
  const signInQuery = useEnvironmentQuery(
    signIn ? serverEnvironment.mcpOAuthSignIn({ environmentId, input: signIn }) : null,
  );
  const signOut = useAtomCommand(serverEnvironment.mcpOAuthSignOut, { reportFailure: false });
  const event = signInQuery.data;
  const authorizationUrl = event?.type === "authorize" ? event.authorizationUrl : null;
  const userCode = event?.type === "authorize" ? event.userCode : undefined;
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

    const prompt = await wait((value) => (value?.type === "authorize" ? value : undefined));
    if (prompt !== undefined && prompt.userCode === undefined)
      void ensureLocalApi()
        .shell.openExternal(prompt.authorizationUrl)
        .catch(() => undefined);
    const connected =
      prompt !== undefined &&
      (await wait((value) => (value?.type === "connected" ? true : undefined)));
    if (controller.signal.aborted) return;
    const result = appAtomRegistry.get(atom);
    abort.current = null;
    setSignIn(null);
    if (connected === true) {
      onChanged();
      toastManager.add({
        type: "success",
        title: m(msg("Signed in to {value0}", { value0: server })),
      });
    } else if (AsyncResult.isFailure(result)) {
      toastManager.add({
        type: "error",
        title: m(msg("Sign-in failed")),
        description: formatEnvironmentQueryError(result.cause),
      });
    }
  };

  if (signIn !== null) {
    return (
      <span className="flex items-center gap-1.5">
        {userCode && <code className="select-all font-mono">{userCode}</code>}
        {authorizationUrl ? (
          <a
            className="text-xs text-muted-foreground underline"
            href={authorizationUrl}
            target="_blank"
            rel="noreferrer"
            onClick={userCode ? () => void copyToClipboard(userCode, undefined) : undefined}
          >
            {userCode ? <T>Copy code &amp; open GitHub</T> : m(msg("Open sign-in page"))}
          </a>
        ) : null}
        <Button size="xs" variant="ghost" onClick={cancel}>
          {m(msg("Cancel"))}
        </Button>
      </span>
    );
  }

  const state = status?.status ?? "signed-out";
  return (
    <span className="flex items-center gap-1.5">
      {state === "connected" ? (
        <Badge variant="success" size="sm">
          {m(msg("Signed in"))}
        </Badge>
      ) : state === "needs-auth" ? (
        <Badge variant="warning" size="sm">
          {m(msg("Sign-in expired"))}
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
          {m(msg("Sign out"))}
        </Button>
      ) : (
        <Button
          size="xs"
          variant="outline"
          disabled={!canManage || httpBaseUrl === null}
          onClick={() => void start()}
        >
          {state === "needs-auth" ? m(msg("Reconnect")) : m(msg("Sign in"))}
        </Button>
      )}
    </span>
  );
}
