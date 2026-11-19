import { msg, useMessages } from "gt-react-native";
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
  const m = useMessages();

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
      Alert.alert(m(msg("Could not enable notifications")), m(msg("Please try again.")));
    } else if (!granted.value) {
      Alert.alert(
        m(msg("Notifications are disabled")),
        m(msg("Allow notifications for T3 Code in system Settings.")),
      );
    } else {
      save({ expoPushEnabled: true });
    }
  };
  return (
    <SettingsScreen title={m(msg("Notifications"))}>
      <ScreenScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="px-5 pt-4"
      >
        <SettingsSection title={m(msg("Agent alerts"))}>
          <SettingsSwitchRow
            icon="bell.badge"
            label={m(msg("Device Notifications"))}
            value={enabled}
            disabled={!configured || requesting || !AsyncResult.isSuccess(preferences)}
            onValueChange={(value) => {
              void change(value);
            }}
          />
        </SettingsSection>
        <AppText className="text-sm text-foreground-muted">
          {!configured
            ? m(msg("This build needs its GMACKO notification configuration."))
            : status.pending
              ? m(msg("Updating notification preferences…"))
              : status.failed > 0
                ? m(
                    msg(
                      "Some environments could not be updated. Reconnect to them to finish enabling or disabling alerts.",
                    ),
                  )
                : enabled
                  ? m(
                      msg("Notifications registered with {value0} paired environment{value1}.", {
                        value0: status.registered,
                        value1: status.registered === 1 ? "" : "s",
                      }),
                    )
                  : m(msg("Notifications are off."))}
        </AppText>
        <AppText className="mt-4 text-sm text-foreground-muted">
          {m(
            msg(
              "Receive alerts when an agent finishes, fails, needs approval, or asks for input. Pair with an environment first. It must stay running and have internet access.",
            ),
          )}
        </AppText>
        {Platform.OS === "ios" ? (
          <>
            <SettingsSection title={m(msg("Lock Screen"))}>
              <SettingsSwitchRow
                icon="bell.badge"
                label={m(msg("Live Activities"))}
                value={activitiesEnabled}
                disabled={!AsyncResult.isSuccess(preferences)}
                onValueChange={(value) => save({ liveActivitiesEnabled: value })}
              />
            </SettingsSection>
            <AppText className="text-sm text-foreground-muted">
              {!activitiesEnabled
                ? m(msg("Live Activities are off."))
                : activityStatus.failed > 0
                  ? m(
                      msg(
                        "Some activities could not connect. Reopen the app after reconnecting to your environments.",
                      ),
                    )
                  : activityStatus.unavailable > 0
                    ? m(
                        msg(
                          "An environment needs an update or Live Activity setup before it can update the Lock Screen.",
                        ),
                      )
                    : m(
                        msg(
                          "Open the app while an agent is working to start its activity. It continues updating while your phone is locked.",
                        ),
                      )}
            </AppText>
          </>
        ) : null}
      </ScreenScrollView>
    </SettingsScreen>
  );
}
