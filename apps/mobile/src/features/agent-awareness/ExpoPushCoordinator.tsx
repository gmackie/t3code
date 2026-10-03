import { useAtomValue } from "@effect/atom-react";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import * as Notifications from "expo-notifications";
import * as Effect from "effect/Effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";
import { makeEnvironmentHttpApiClient } from "@t3tools/client-runtime/rpc";
import { createExpoPushRegistration, type ExpoPushConnection } from "./expoPushRegistration";
import { runtime } from "../../lib/runtime";
import { mobilePreferencesAtom } from "../../state/preferences";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";

export function usesExpoPush(): boolean {
  return Constants.expoConfig?.extra?.appVariant === "gmacko";
}

export function expoPushProjectId(): string | null {
  const id: unknown = Constants.expoConfig?.extra?.eas?.projectId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

type Status = { readonly pending: boolean; readonly registered: number; readonly failed: number };
let status: Status = { pending: false, registered: 0, failed: 0 };
const listeners = new Set<() => void>();
function publishStatus(next: Status) {
  status = next;
  for (const listener of listeners) listener();
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function useExpoPushStatus() {
  return useSyncExternalStore(subscribe, () => status);
}

async function register(connection: ExpoPushConnection, token: string | null) {
  if (!connection.bearerToken) throw new Error("Push registration requires a paired connection.");
  await runtime.runPromise(
    Effect.gen(function* () {
      const client = yield* makeEnvironmentHttpApiClient(connection.httpBaseUrl);
      yield* client.notifications
        .register({
          headers: { authorization: `Bearer ${connection.bearerToken}` },
          payload: { token },
        })
        .pipe(
          Effect.catchTag("EnvironmentAuthInvalidError", (error) =>
            token === null ? Effect.void : Effect.fail(error),
          ),
          Effect.timeout("15 seconds"),
        );
    }),
  );
}

export function ExpoPushCoordinator() {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const { savedConnectionsById, isLoadingSavedConnection } = useSavedRemoteConnections();
  const enabled =
    !isLoadingSavedConnection && AsyncResult.isSuccess(preferences)
      ? preferences.value.expoPushEnabled === true
      : null;
  const latest = useRef({ enabled, savedConnectionsById });
  const refreshRef = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    latest.current = { enabled, savedConnectionsById };
    refreshRef.current?.();
  }, [enabled, savedConnectionsById]);

  useEffect(() => {
    if (!usesExpoPush()) return;
    let disposed = false;
    let running = false;
    let again = false;
    const synchronize = createExpoPushRegistration(register, {
      read: () => SecureStore.getItemAsync("t3code.expo-push.registrations"),
      write: (value) => SecureStore.setItemAsync("t3code.expo-push.registrations", value),
    });
    const refresh = async () => {
      again = true;
      if (running) return;
      running = true;
      try {
        while (again) {
          if (disposed) break;
          again = false;
          const current = latest.current;
          if (current.enabled === null) continue;
          const enabled = current.enabled;
          publishStatus({ pending: true, registered: 0, failed: 0 });
          let token: string | null = null;
          try {
            if (enabled) {
              const projectId = expoPushProjectId();
              if (!projectId) throw new Error("This build has no GMACKO Expo project.");
              if (Platform.OS === "android")
                await Notifications.setNotificationChannelAsync("default", {
                  name: "Agent notifications",
                  importance: Notifications.AndroidImportance.DEFAULT,
                });
              const permission = await Notifications.getPermissionsAsync();
              if (permission.granted)
                token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
            }
            const result = await synchronize(current.savedConnectionsById, token);
            if (!disposed) publishStatus({ pending: false, ...result });
          } catch {
            if (!disposed)
              publishStatus({
                pending: false,
                registered: 0,
                failed: Math.max(1, Object.keys(current.savedConnectionsById).length),
              });
          }
        }
      } finally {
        running = false;
      }
    };
    const trigger = () => {
      void refresh();
    };
    refreshRef.current = trigger;
    trigger();
    const foreground = AppState.addEventListener("change", (state) => {
      if (state === "active") trigger();
    });
    const tokenChange = Notifications.addPushTokenListener(trigger);
    return () => {
      disposed = true;
      refreshRef.current = null;
      foreground.remove();
      tokenChange.remove();
    };
  }, []);
  return null;
}
