import { useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThreadList } from "../../src/components/ThreadList";
import { refreshAllEnvironmentRuntimes } from "../../src/lib/runtimeRefresh";
import { listThreadSummaries, useThreadStore } from "../../src/state/threadStore";
import { mobileTheme } from "../../src/theme";

export default function ThreadsScreen() {
  const applySnapshot = useThreadStore((state) => state.applySnapshot);
  const setConnectionState = useThreadStore((state) => state.setEnvironmentConnectionState);
  const threadSummaryByKey = useThreadStore((state) => state.threadSummaryByKey);
  const threads = Object.keys(threadSummaryByKey).length > 0 ? listThreadSummaries() : [];

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
        <Text style={styles.eyebrow}>Threads</Text>
        <Text style={styles.title}>Recent work across environments</Text>
        <ThreadList threads={threads} />
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
