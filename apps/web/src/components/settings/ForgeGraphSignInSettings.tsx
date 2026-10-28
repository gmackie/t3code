import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  ForgeGraphSignInState,
  SourceControlProviderAuth,
} from "@t3tools/contracts";
import {
  FORGEGRAPH_SIGN_IN_STATUS_INTERVAL_MS,
  forgeGraphSignInFailure,
  forgeGraphSignInView,
} from "@t3tools/client-runtime/forgegraph-sign-in";
import { readForgeGraphSettings } from "@t3tools/client-runtime/source-control-clients";
import * as Option from "effect/Option";
import { ExternalLinkIcon } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { sourceControlEnvironment } from "../../state/sourceControl";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button, InlineButton } from "../ui/button";

/**
 * Signs the environment in to ForgeGraph. The server runs the device flow and keeps the token,
 * so this only shows the code to approve and where to approve it, from any client.
 */
export function ForgeGraphSignInSettings({
  environmentId,
  auth,
  onChanged,
}: {
  readonly environmentId: EnvironmentId;
  readonly auth: SourceControlProviderAuth;
  /** Rescans discovery, so the signed-in account shows once the token is saved or removed. */
  readonly onChanged: () => void;
}) {
  const { token } = useEnvironmentSettings(environmentId, readForgeGraphSettings);
  const canSignIn = useAtomValue(
    sourceControlEnvironment.forgeGraphSignInStart.permissionAtom(environmentId),
  );
  const start = useAtomCommand(sourceControlEnvironment.forgeGraphSignInStart, {
    label: "start ForgeGraph sign-in",
  });
  const status = useAtomCommand(sourceControlEnvironment.forgeGraphSignInStatus, {
    label: "read ForgeGraph sign-in",
  });
  const cancel = useAtomCommand(sourceControlEnvironment.forgeGraphSignInCancel, {
    label: "cancel ForgeGraph sign-in",
  });
  const signOut = useAtomCommand(sourceControlEnvironment.forgeGraphSignOut, {
    label: "sign out of ForgeGraph",
  });
  const initialStatus = useEnvironmentQuery(
    canSignIn ? sourceControlEnvironment.forgeGraphSignInState({ environmentId, input: {} }) : null,
  );
  const [localState, setState] = useState<ForgeGraphSignInState | null>(null);
  const state = localState ?? initialStatus.data;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notifyChanged = useEffectEvent(onChanged);

  const run = async (command: typeof start) => {
    setBusy(true);
    try {
      setError(null);
      const result = await command({ environmentId, input: {} });
      if (result._tag === "Success") setState(result.value);
      else setError(forgeGraphSignInFailure(result));
      return result;
    } finally {
      setBusy(false);
    }
  };

  const waiting = state?.phase === "waiting";
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Poll the external device-flow attempt while pending, and release its timer when it ends or the view unmounts.
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      void status({ environmentId, input: {} }).then((result) => {
        if (result._tag !== "Success") return;
        setState(result.value);
        if (result.value.phase === "succeeded") notifyChanged();
      });
    }, FORGEGRAPH_SIGN_IN_STATUS_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [waiting, environmentId, status]);

  const savedInT3 = token.length > 0;
  const view = forgeGraphSignInView({
    signedIn: auth.status === "authenticated",
    host: Option.getOrNull(auth.host),
    savedInT3,
    state,
  });

  return (
    <div className="grid gap-3">
      <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
        {/* The account itself is shown, redactable, in the row above. */}
        {view.summary}
      </p>

      {view.pending ? (
        <div className="grid gap-2 rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground">
            Approve this code in ForgeGraph. This page updates once you do.
          </p>
          <code className="font-mono text-base tracking-widest">{view.pending.userCode}</code>
          <InlineButton
            render={
              <a href={view.pending.verificationUrl} target="_blank" rel="noreferrer noopener" />
            }
          >
            Open {view.pending.verificationUrl}
            <ExternalLinkIcon aria-hidden className="size-3" />
          </InlineButton>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="max-w-2xl text-xs text-destructive">
          {error}
        </p>
      ) : null}

      {view.message ? (
        <p className="max-w-2xl text-xs text-muted-foreground">{view.message}</p>
      ) : null}

      <div className="flex justify-end gap-2">
        {view.canCancel ? (
          <Button size="xs" variant="outline" disabled={busy} onClick={() => void run(cancel)}>
            Cancel
          </Button>
        ) : (
          <>
            {view.canSignOut ? (
              <Button
                size="xs"
                variant="outline"
                disabled={busy || !canSignIn}
                onClick={() =>
                  void run(signOut).then((result) => {
                    if (result._tag === "Success") onChanged();
                  })
                }
              >
                Sign out
              </Button>
            ) : null}
            <Button size="xs" disabled={busy || !canSignIn} onClick={() => void run(start)}>
              {view.signInLabel}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
