import { useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { InboxList } from "../../src/components/InboxList";
import { refreshAllEnvironmentRuntimes } from "../../src/lib/runtimeRefresh";
import { useThreadStore } from "../../src/state/threadStore";
import { mobileTheme } from "../../src/theme";

export default function InboxScreen() {
  const inbox = useThreadStore((state) => state.inbox);
  const applySnapshot = useThreadStore((state) => state.applySnapshot);
  const setConnectionState = useThreadStore((state) => state.setEnvironmentConnectionState);

  useFocusEffect(
    useCallback(() => {
      void refreshAllEnvironmentRuntimes({
        applySnapshot,
        setConnectionState,
      });
    }, [applySnapshot, setConnectionState]),
  );

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>Inbox</Text>
        <Text style={styles.title}>What needs you now</Text>
        <InboxList items={inbox} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: mobileTheme.colors.background,
  },
  content: {
    gap: mobileTheme.spacing.md,
    padding: mobileTheme.spacing.lg,
  },
  eyebrow: {
    color: mobileTheme.colors.accent,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  title: {
    color: mobileTheme.colors.text,
    fontSize: 30,
    fontWeight: "700",
  },
});
