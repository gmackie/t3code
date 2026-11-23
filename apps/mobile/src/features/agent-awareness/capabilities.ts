import Constants from "expo-constants";
import { Platform } from "react-native";
import { supportsAndroidAgentNotifications } from "./androidNotifications";

export function usesExpoPush(): boolean {
  return Constants.expoConfig?.extra?.appVariant === "gmacko";
}

export function supportsAgentAwarenessPush() {
  if (usesExpoPush()) return false;
  return Platform.OS === "android"
    ? supportsAndroidAgentNotifications()
    : Platform.OS === "ios" && Constants.expoConfig?.extra?.iosPersonalTeamBuild !== true;
}
