import { useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThreadList } from "../../src/components/ThreadList";
import { loadSavedEnvironmentSnapshot } from "../../src/lib/runtimeClient";
import {
  hydrateEnvironmentStore,
  listEnvironmentRecords,
  readEnvironmentSecret,
} from "../../src/state/environmentStore";
import { listThreadSummaries, useThreadStore } from "../../src/state/threadStore";
import { mobileTheme } from "../../src/theme";

async function refreshRuntime(
  applySnapshot: (environmentId: never, snapshot: never) => void,
  setConnectionState: (environmentId: never, state: "idle" | "syncing" | "ready" | "error") => void,
): Promise<void> {
  await hydrateEnvironmentStore();
  const records = listEnvironmentRecords();
  await Promise.all(
    records.map(async (record) => {
      const token = await readEnvironmentSecret(record.environmentId);
      if (!token) {
        return;
      }

      setConnectionState(record.environmentId as never, "syncing");
      try {
        const loaded = await loadSavedEnvironmentSnapshot({
          record,
          sessionToken: token,
        });
        applySnapshot(loaded.environmentId as never, loaded.snapshot as never);
      } catch (error) {
        console.error("[mobile] failed to refresh runtime", error);
        setConnectionState(record.environmentId as never, "error");
      }
    }),
  );
}

export default function ThreadsScreen() {
  const applySnapshot = useThreadStore((state) => state.applySnapshot);
  const setConnectionState = useThreadStore((state) => state.setEnvironmentConnectionState);
  const threadSummaryByKey = useThreadStore((state) => state.threadSummaryByKey);
  const threads = Object.keys(threadSummaryByKey).length > 0 ? listThreadSummaries() : [];

  useFocusEffect(
    useCallback(() => {
      void refreshRuntime(applySnapshot as never, setConnectionState as never);
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
