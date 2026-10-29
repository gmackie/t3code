import { useAtomValue } from "@effect/atom-react";
import { makeEnvironmentHttpApiClient } from "@t3tools/client-runtime/rpc";
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import * as Effect from "effect/Effect";
import { AsyncResult, Atom } from "effect/reactivity";
import * as Option from "effect/Option";
import type { LiveActivityRegistration } from "@t3tools/contracts";
import { runtime } from "../../lib/runtime";
import { mobilePreferencesAtom } from "../../state/preferences";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import { environmentCatalog } from "../../connection/catalog";
import { environmentShell } from "../../state/shell";
import { getAgentLiveActivities, startAgentLiveActivity } from "./agentLiveActivity";
import { createEnvironmentLiveActivitySync } from "./environmentLiveActivities";
import type { ExpoPushConnection } from "./expoPushRegistration";

// Native activities start in the foreground. Subscribe only to shell lifecycle changes,
// so streamed message chunks do not cause HTTP discovery or React renders.
const discoveryAtom = Atom.make((get) => {
  const catalog = get(environmentCatalog.catalogValueAtom);
  return [...catalog.entries.keys()]
    .map((id) => {
      const shell = get(environmentShell.stateValueAtom(id));
      const threads = Option.isSome(shell.snapshot) ? shell.snapshot.value.threads : [];
      return `${id}:${shell.status}:${threads.map((thread) => `${thread.id}:${thread.status}:${thread.activityRunStatus}:${thread.latestRunId}:${thread.pendingRuntimeRequest?.id ?? ""}`).join(",")}`;
    })
    .join(";");
});

type Status = { readonly active: number; readonly failed: number; readonly unavailable: number };
let status: Status = { active: 0, failed: 0, unavailable: 0 };
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function useEnvironmentLiveActivityStatus() {
  return useSyncExternalStore(subscribe, () => status);
}

const snapshot = (connection: ExpoPushConnection) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const client = yield* makeEnvironmentHttpApiClient(connection.httpBaseUrl);
      return yield* client.notifications
        .liveActivitySnapshot({ headers: { authorization: `Bearer ${connection.bearerToken}` } })
        .pipe(Effect.timeout("15 seconds"));
    }),
  );
const register = (connection: ExpoPushConnection, payload: LiveActivityRegistration) =>
  runtime.runPromise(
    Effect.gen(function* () {
      const client = yield* makeEnvironmentHttpApiClient(connection.httpBaseUrl);
      yield* client.notifications
        .registerLiveActivity({
          headers: { authorization: `Bearer ${connection.bearerToken}` },
          payload,
        })
        .pipe(
          Effect.catchTags({
            EnvironmentAuthInvalidError: (error) =>
              payload.token === null ? Effect.void : Effect.fail(error),
          }),
          Effect.timeout("15 seconds"),
        );
    }),
  );

export function EnvironmentLiveActivityCoordinator() {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const { savedConnectionsById, isLoadingSavedConnection } = useSavedRemoteConnections();
  const discovery = useAtomValue(discoveryAtom);
  const enabled =
    !isLoadingSavedConnection && AsyncResult.isSuccess(preferences)
      ? preferences.value.liveActivitiesEnabled !== false
      : null;
  const latest = useRef({ enabled, savedConnectionsById, discovery });
  const refreshRef = useRef<(() => void) | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Native lifecycle callbacks read the latest saved connections and preference before creating cards.
  useLayoutEffect(() => {
    latest.current = { enabled, savedConnectionsById, discovery };
    refreshRef.current?.();
  }, [enabled, savedConnectionsById, discovery]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Own native token and foreground subscriptions for the lifetime of this coordinator.
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    let disposed = false;
    let running = false;
    let again = false;
    const synchronize = createEnvironmentLiveActivitySync({
      snapshot,
      register,
      list: getAgentLiveActivities,
      start: startAgentLiveActivity,
      read: () => SecureStore.getItemAsync("t3code.environment-live-activities"),
      write: (value) => SecureStore.setItemAsync("t3code.environment-live-activities", value),
      onToken: () => refresh(),
      canStart: () => AppState.currentState === "active",
    });
    const drain = async () => {
      while (again && !disposed) {
        again = false;
        const current = latest.current;
        if (current.enabled === null) continue;
        const result = await synchronize.synchronize(
          current.savedConnectionsById,
          current.enabled,
          () => !disposed && latest.current === current,
        );
        if (!disposed) {
          status = result;
          for (const listener of listeners) listener();
        }
      }
    };
    const refresh = () => {
      again = true;
      if (running) return;
      running = true;
      void drain()
        .catch(() => {
          status = { active: 0, failed: 1, unavailable: 0 };
          for (const listener of listeners) listener();
        })
        .finally(() => {
          running = false;
        });
    };
    refreshRef.current = refresh;
    refresh();
    const foreground = AppState.addEventListener("change", (value) => {
      if (value === "active") refresh();
    });
    return () => {
      disposed = true;
      refreshRef.current = null;
      foreground.remove();
      synchronize.dispose();
    };
  }, []);
  return null;
}
