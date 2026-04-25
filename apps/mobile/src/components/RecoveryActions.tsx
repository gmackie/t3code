import { Pressable, StyleSheet, Text, View } from "react-native";

import { mobileTheme } from "../theme";

export function RecoveryActions({
  disabled,
  onRefresh,
  onInterrupt,
  onStop,
}: {
  readonly disabled?: boolean;
  readonly onRefresh: () => Promise<void>;
  readonly onInterrupt: () => Promise<void>;
  readonly onStop: () => Promise<void>;
}) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Recovery</Text>
      <View style={styles.actions}>
        <Pressable disabled={disabled} onPress={() => void onRefresh()} style={styles.button}>
          <Text style={styles.buttonLabel}>Reconnect</Text>
        </Pressable>
        <Pressable disabled={disabled} onPress={() => void onInterrupt()} style={styles.button}>
          <Text style={styles.buttonLabel}>Interrupt</Text>
        </Pressable>
        <Pressable disabled={disabled} onPress={() => void onStop()} style={styles.dangerButton}>
          <Text style={styles.dangerLabel}>Stop</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: mobileTheme.colors.surface,
    borderRadius: 8,
    gap: mobileTheme.spacing.sm,
    padding: mobileTheme.spacing.md,
  },
  title: {
    color: mobileTheme.colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  actions: {
    flexDirection: "row",
    gap: mobileTheme.spacing.sm,
  },
  button: {
    alignItems: "center",
    borderColor: "#d8c8b4",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 42,
  },
  buttonLabel: {
    color: mobileTheme.colors.text,
    fontSize: 13,
    fontWeight: "700",
  },
  dangerButton: {
    alignItems: "center",
    backgroundColor: "#7f1d1d",
    borderRadius: 8,
    flex: 1,
    justifyContent: "center",
    minHeight: 42,
  },
  dangerLabel: {
    color: "#fffaf2",
    fontSize: 13,
    fontWeight: "700",
  },
});
