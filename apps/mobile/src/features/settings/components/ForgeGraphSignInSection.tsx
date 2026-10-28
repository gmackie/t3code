import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import {
  FORGEGRAPH_SIGN_IN_STATUS_INTERVAL_MS,
  forgeGraphSignInFailure,
  forgeGraphSignInView,
} from "@t3tools/client-runtime/forgegraph-sign-in";
import { readForgeGraphSettings } from "@t3tools/client-runtime/source-control-clients";
import { settlePromise, type AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import type { ForgeGraphSignInState } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Linking, View } from "react-native";

import { AppText as Text } from "../../../components/ui/AppText";
import { useEnvironmentQuery } from "../../../state/query";
import { sourceControlEnvironment } from "../../../state/sourceControl";
import { useAtomCommand } from "../../../state/use-atom-command";
import { forgeGraphDiscoveryAuth } from "../forgegraph-sign-in";
import type { SettingsTarget } from "../settings-environment-filter";
import { ListActionRow as SettingsActionRow } from "../../../components/ui/ListActionRow";
import { SettingsSection } from "./SettingsSection";

const COMMAND_OPTIONS = { reportFailure: false, reportDefect: false };

/**
 * Signs one environment in to ForgeGraph. Renders nothing until that environment's source
 * control discovery finds ForgeGraph. The server runs the device flow and keeps the token.
 */
export function ForgeGraphSignInSection(props: {
  readonly environment: SettingsTarget;
  /** Names the environment in the title, for when several are selected. */
  readonly showEnvironmentLabel: boolean;
}) {
  const environmentId = props.environment.environmentId;
  const discovery = useEnvironmentQuery(
    sourceControlEnvironment.discovery({ environmentId, input: {} }),
  );
  const auth = forgeGraphDiscoveryAuth(discovery.data);
  if (auth === null) return null;
  return (
    <SettingsSection
      title={props.showEnvironmentLabel ? `ForgeGraph · ${props.environment.label}` : "ForgeGraph"}
    >
      <ForgeGraphSignIn
        environment={props.environment}
        signedIn={auth.signedIn}
        host={auth.host}
        onChanged={discovery.refresh}
      />
    </SettingsSection>
  );
}

function ForgeGraphSignIn(props: {
  readonly environment: SettingsTarget;
  readonly signedIn: boolean;
  readonly host: string | null;
  /** Rescans discovery once a token is saved or removed. */
  readonly onChanged: () => void;
}) {
  const environmentId = props.environment.environmentId;
  const savedInT3 =
    readForgeGraphSettings(props.environment.serverConfig.settings).token.length > 0;
  const canSignIn = useAtomValue(
    sourceControlEnvironment.forgeGraphSignInStart.permissionAtom(environmentId),
  );
  const start = useAtomCommand(sourceControlEnvironment.forgeGraphSignInStart, COMMAND_OPTIONS);
  const status = useAtomCommand(sourceControlEnvironment.forgeGraphSignInStatus, COMMAND_OPTIONS);
  const cancel = useAtomCommand(sourceControlEnvironment.forgeGraphSignInCancel, COMMAND_OPTIONS);
  const signOut = useAtomCommand(sourceControlEnvironment.forgeGraphSignOut, COMMAND_OPTIONS);
  const initialStatus = useEnvironmentQuery(
    canSignIn ? sourceControlEnvironment.forgeGraphSignInState({ environmentId, input: {} }) : null,
  );
  const [localState, setState] = useState<ForgeGraphSignInState | null>(null);
  const state = localState ?? initialStatus.data;
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const onChanged = useEffectEvent(() => props.onChanged());

  const run = async (command: typeof start, onSuccess?: () => void) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const settled = await settlePromise(
      (): Promise<AtomCommandResult<ForgeGraphSignInState, unknown>> =>
        command({ environmentId, input: {} }),
    );
    busyRef.current = false;
    setBusy(false);
    const result = AsyncResult.isSuccess(settled) ? settled.value : settled;
    if (result._tag === "Success") {
      setState(result.value);
      onSuccess?.();
    } else {
      setError(forgeGraphSignInFailure(result));
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
        if (result.value.phase === "succeeded") onChanged();
      });
    }, FORGEGRAPH_SIGN_IN_STATUS_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [waiting, environmentId, status]);

  const view = forgeGraphSignInView({
    signedIn: props.signedIn,
    host: props.host,
    savedInT3,
    state,
  });
  const pending = view.pending;

  return (
    <>
      <View className="gap-2 p-4">
        <Text accessibilityLiveRegion="polite" className="text-sm text-foreground-muted">
          {view.summary}
        </Text>
        {pending ? (
          <>
            <Text className="text-sm text-foreground-muted">
              Approve this code in ForgeGraph. This page updates once you do.
            </Text>
            <Text selectable className="font-mono text-2xl tracking-widest text-foreground">
              {pending.userCode}
            </Text>
            <Text selectable className="text-sm text-foreground-muted">
              {pending.verificationUrl}
            </Text>
          </>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" className="text-sm text-danger-foreground">
            {error}
          </Text>
        ) : null}
        {view.message ? (
          <Text className="text-sm text-foreground-muted">{view.message}</Text>
        ) : null}
      </View>
      {pending ? (
        <SettingsActionRow
          icon="globe"
          label="Open ForgeGraph to approve"
          onPress={() => {
            void Linking.openURL(pending.verificationUrl).catch(() =>
              setError(`Could not open ${pending.verificationUrl}.`),
            );
          }}
        />
      ) : null}
      {view.canCancel ? (
        <SettingsActionRow
          icon="xmark"
          label="Cancel"
          disabled={busy}
          loading={busy}
          onPress={() => void run(cancel)}
        />
      ) : (
        <>
          <SettingsActionRow
            icon="person.crop.circle"
            label={view.signInLabel}
            disabled={busy || !canSignIn}
            loading={busy}
            onPress={() => void run(start)}
          />
          {view.canSignOut ? (
            <SettingsActionRow
              icon="person.crop.circle"
              label="Sign out"
              tone="danger"
              disabled={busy || !canSignIn}
              onPress={() => void run(signOut, props.onChanged)}
            />
          ) : null}
        </>
      )}
    </>
  );
}
