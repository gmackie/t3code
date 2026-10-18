import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  ForgeGraphSignInState,
  SourceControlProviderAuth,
} from "@t3tools/contracts";
import { readForgeGraphSettings } from "@t3tools/client-runtime/source-control-clients";
import * as Option from "effect/Option";
import { ExternalLinkIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { sourceControlEnvironment } from "../../state/sourceControl";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button, InlineButton } from "../ui/button";

/** How often a waiting sign-in asks the server whether the code was approved. */
const STATUS_INTERVAL_MS = 3_000;

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
  const [state, setState] = useState<ForgeGraphSignInState | null>(null);
  const [busy, setBusy] = useState(false);
  // Held so a parent re-render does not restart the status interval.
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  }, [onChanged]);

  const run = async (command: typeof start) => {
    setBusy(true);
    try {
      const result = await command({ environmentId, input: {} });
      if (result._tag === "Success") setState(result.value);
      return result;
    } finally {
      setBusy(false);
    }
  };

  // An attempt started from another client, or before a reload, is picked up where it stands.
  useEffect(() => {
    if (!canSignIn) return;
    void status({ environmentId, input: {} }).then((result) => {
      if (result._tag === "Success") setState(result.value);
    });
  }, [canSignIn, environmentId, status]);

  const waiting = state?.phase === "waiting";
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      void status({ environmentId, input: {} }).then((result) => {
        if (result._tag !== "Success") return;
        setState(result.value);
        if (result.value.phase === "succeeded") onChangedRef.current();
      });
    }, STATUS_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [waiting, environmentId, status]);

  const account = Option.getOrNull(auth.account);
  const signedIn = auth.status === "authenticated";
  const savedInT3 = token.length > 0;

  return (
    <div className="grid gap-3">
      <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
        {signedIn
          ? account
            ? `Signed in as ${account}${Option.isSome(auth.host) ? ` on ${auth.host.value}` : ""}.`
            : "Signed in."
          : "Not signed in. Sign in here, or set FG_API_TOKEN or run `forge login` on the server."}
        {signedIn && !savedInT3 ? " The token comes from FG_API_TOKEN or the forge CLI." : null}
      </p>

      {waiting && state.userCode && state.verificationUrl ? (
        <div className="grid gap-2 rounded-md border border-border p-3">
          <p className="text-xs text-muted-foreground">
            Approve this code in ForgeGraph. This page updates once you do.
          </p>
          <code className="font-mono text-base tracking-widest">{state.userCode}</code>
          <InlineButton
            render={<a href={state.verificationUrl} target="_blank" rel="noreferrer noopener" />}
          >
            Open {state.verificationUrl}
            <ExternalLinkIcon aria-hidden className="size-3" />
          </InlineButton>
        </div>
      ) : null}

      {state?.message && !waiting ? (
        <p className="max-w-2xl text-xs text-muted-foreground">{state.message}</p>
      ) : null}

      <div className="flex justify-end gap-2">
        {waiting ? (
          <Button size="xs" variant="outline" disabled={busy} onClick={() => void run(cancel)}>
            Cancel
          </Button>
        ) : (
          <>
            {savedInT3 ? (
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
              {savedInT3 ? "Sign in again" : "Sign in with ForgeGraph"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
