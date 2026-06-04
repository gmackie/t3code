import { Alert, Linking } from "react-native";

const localNetworkFailureMarker = "enable Local Network access for T3 Code Mobile";

export function showPairingFailureAlert(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const buttons = message.includes(localNetworkFailureMarker)
    ? [
        { text: "OK", style: "cancel" as const },
        {
          text: "Open Settings",
          onPress: () => {
            void Linking.openSettings();
          },
        },
      ]
    : undefined;

  Alert.alert("Pairing failed", message, buttons);
}
