import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";
import { Alert, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { AppText } from "../../components/ui/AppText";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { expoPushProjectId, useExpoPushStatus } from "../agent-awareness/ExpoPushCoordinator";
import { useEnvironmentLiveActivityStatus } from "../agent-awareness/EnvironmentLiveActivityCoordinator";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";

async function requestExpoPushPermission(): Promise<boolean> {
  if (Platform.OS === "android")
    await Notifications.setNotificationChannelAsync("default", {
      name: "Agent notifications",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  const permission = await Notifications.requestPermissionsAsync();
  return permission.granted;
}

export function SettingsExpoNotifications() {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const save = useAtomSet(updateMobilePreferencesAtom);
  const status = useExpoPushStatus();
  const activityStatus = useEnvironmentLiveActivityStatus();
  const activitiesEnabled =
    AsyncResult.isSuccess(preferences) && preferences.value.liveActivitiesEnabled !== false;
  const [requesting, setRequesting] = useState(false);
  const configured = expoPushProjectId() !== null;
  const enabled = AsyncResult.isSuccess(preferences) && preferences.value.expoPushEnabled === true;
  const change = async (value: boolean) => {
    if (!value) {
      save({ expoPushEnabled: false });
      return;
    }
    setRequesting(true);
    const granted = await settlePromise(requestExpoPushPermission);
    setRequesting(false);
    if (AsyncResult.isFailure(granted)) {
      Alert.alert("Could not enable notifications", "Please try again.");
    } else if (!granted.value) {
      Alert.alert(
        "Notifications are disabled",
        "Allow notifications for T3 Code in system Settings.",
      );
    } else {
      save({ expoPushEnabled: true });
    }
  };
  return (
    <SettingsScreen title="Notifications">
      <ScreenScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="px-5 pt-4"
      >
        <SettingsSection title="Agent alerts">
          <SettingsSwitchRow
            icon="bell.badge"
            label="Device Notifications"
            value={enabled}
            disabled={!configured || requesting || !AsyncResult.isSuccess(preferences)}
            onValueChange={(value) => {
              void change(value);
            }}
          />
        </SettingsSection>
        <AppText className="text-sm text-foreground-muted">
          {!configured
            ? "This build needs its GMACKO notification configuration."
            : status.pending
              ? "Updating notification preferences…"
              : status.failed > 0
                ? "Some environments could not be updated. Reconnect to them to finish enabling or disabling alerts."
                : enabled
                  ? `Notifications registered with ${status.registered} paired environment${status.registered === 1 ? "" : "s"}.`
                  : "Notifications are off."}
        </AppText>
        <AppText className="mt-4 text-sm text-foreground-muted">
          Receive alerts when an agent finishes, fails, needs approval, or asks for input. Pair with
          an environment first. It must stay running and have internet access.
        </AppText>
        {Platform.OS === "ios" ? (
          <>
            <SettingsSection title="Lock Screen">
              <SettingsSwitchRow
                icon="bell.badge"
                label="Live Activities"
                value={activitiesEnabled}
                disabled={!AsyncResult.isSuccess(preferences)}
                onValueChange={(value) => save({ liveActivitiesEnabled: value })}
              />
            </SettingsSection>
            <AppText className="text-sm text-foreground-muted">
              {!activitiesEnabled
                ? "Live Activities are off."
                : activityStatus.failed > 0
                  ? "Some activities could not connect. Reopen the app after reconnecting to your environments."
                  : activityStatus.unavailable > 0
                    ? "An environment needs an update or Live Activity setup before it can update the Lock Screen."
                    : "Open the app while an agent is working to start its activity. It continues updating while your phone is locked."}
            </AppText>
          </>
        ) : null}
      </ScreenScrollView>
    </SettingsScreen>
  );
}
