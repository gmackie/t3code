import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { useState } from "react";
import { Alert, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { ScreenScrollView } from "../../components/ScreenScrollView";
import { AppText } from "../../components/AppText";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { expoPushProjectId, useExpoPushStatus } from "../agent-awareness/ExpoPushCoordinator";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";

export function SettingsExpoNotifications() {
  const preferences = useAtomValue(mobilePreferencesAtom);
  const save = useAtomSet(updateMobilePreferencesAtom);
  const status = useExpoPushStatus();
  const [requesting, setRequesting] = useState(false);
  const configured = expoPushProjectId() !== null;
  const enabled = AsyncResult.isSuccess(preferences) && preferences.value.expoPushEnabled === true;
  const change = async (value: boolean) => {
    if (!value) {
      save({ expoPushEnabled: false });
      return;
    }
    setRequesting(true);
    try {
      if (Platform.OS === "android")
        await Notifications.setNotificationChannelAsync("default", {
          name: "Agent notifications",
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      const permission = await Notifications.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          "Notifications are disabled",
          "Allow notifications for T3 Code in system Settings.",
        );
        return;
      }
      save({ expoPushEnabled: true });
    } catch {
      Alert.alert("Could not enable notifications", "Please try again.");
    } finally {
      setRequesting(false);
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
          an environment first. It must stay running and have internet access. Live Activities are
          not available with these notifications.
        </AppText>
      </ScreenScrollView>
    </SettingsScreen>
  );
}
