import type { EnvironmentId } from "@t3tools/contracts";
import { Link, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ProjectList } from "../../src/components/ProjectList";
import { refreshEnvironmentRuntimeById } from "../../src/lib/runtimeRefresh";
import { useEnvironmentStore } from "../../src/state/environmentStore";
import { listProjectSummaries, useThreadStore } from "../../src/state/threadStore";
import { mobileTheme } from "../../src/theme";

export default function EnvironmentWorkspaceScreen() {
  const params = useLocalSearchParams<{ environmentId?: string }>();
  const environmentId = params.environmentId as EnvironmentId | undefined;
  const record = useEnvironmentStore((state) =>
    environmentId ? state.recordsById[environmentId] : null,
  );
  const projectSummaryByKey = useThreadStore((state) => state.projectSummaryByKey);
  const connectionState = useThreadStore(
    (state) =>
      (environmentId ? state.connectionStateByEnvironment[environmentId] : undefined) ?? "idle",
  );
  const applySnapshot = useThreadStore((state) => state.applySnapshot);
  const setConnectionState = useThreadStore((state) => state.setEnvironmentConnectionState);
  const projects =
    environmentId && Object.keys(projectSummaryByKey).length > 0
      ? listProjectSummaries(environmentId)
      : [];

  const refresh = useCallback(async () => {
    if (!environmentId) {
      return;
    }

    try {
      await refreshEnvironmentRuntimeById(environmentId, {
        applySnapshot,
        setConnectionState,
      });
    } catch (error) {
      console.error("[mobile] failed to refresh environment runtime", error);
    }
  }, [applySnapshot, environmentId, setConnectionState]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.eyebrow}>Environment</Text>
          <Text style={styles.title}>{record?.label ?? "Paired environment"}</Text>
          <Text style={styles.copy}>{record?.httpBaseUrl ?? "Loading saved environment..."}</Text>
        </View>
        <View style={styles.actions}>
          <Pressable onPress={refresh} style={styles.primaryButton}>
            <Text style={styles.primaryButtonLabel}>
              {connectionState === "syncing" ? "Refreshing..." : "Refresh"}
            </Text>
          </Pressable>
          <Link asChild href="/(tabs)/threads">
            <Pressable style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonLabel}>All Threads</Text>
            </Pressable>
          </Link>
        </View>
        <Text style={styles.sectionTitle}>Projects</Text>
        <ProjectList environmentId={environmentId ?? ""} projects={projects} />
        <Link href="/settings" style={styles.link}>
          Back to paired environments
        </Link>
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
  header: {
    gap: mobileTheme.spacing.sm,
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
  copy: {
    color: mobileTheme.colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
  },
  actions: {
    flexDirection: "row",
    gap: mobileTheme.spacing.sm,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: mobileTheme.colors.accent,
    borderRadius: 999,
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
  },
  primaryButtonLabel: {
    color: "#fffaf2",
    fontSize: 14,
    fontWeight: "700",
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: mobileTheme.colors.surface,
    borderRadius: 999,
    flex: 1,
    justifyContent: "center",
    minHeight: 44,
  },
  secondaryButtonLabel: {
    color: mobileTheme.colors.accent,
    fontSize: 14,
    fontWeight: "700",
  },
  sectionTitle: {
    color: mobileTheme.colors.text,
    fontSize: 20,
    fontWeight: "700",
  },
  link: {
    color: mobileTheme.colors.accent,
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
  },
});
