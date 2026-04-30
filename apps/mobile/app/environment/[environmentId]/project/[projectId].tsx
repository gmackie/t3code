import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { Link, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThreadList } from "../../../../src/components/ThreadList";
import { refreshEnvironmentRuntimeById } from "../../../../src/lib/runtimeRefresh";
import { useEnvironmentStore } from "../../../../src/state/environmentStore";
import {
  getProjectSummary,
  listThreadSummariesForProject,
  useThreadStore,
} from "../../../../src/state/threadStore";
import { mobileTheme } from "../../../../src/theme";

export default function ProjectThreadsScreen() {
  const params = useLocalSearchParams<{ environmentId?: string; projectId?: string }>();
  const environmentId = params.environmentId as EnvironmentId | undefined;
  const projectId = params.projectId as ProjectId | undefined;
  const record = useEnvironmentStore((state) =>
    environmentId ? state.recordsById[environmentId] : null,
  );
  const projectSummaryByKey = useThreadStore((state) => state.projectSummaryByKey);
  const threadSummaryByKey = useThreadStore((state) => state.threadSummaryByKey);
  const connectionState = useThreadStore(
    (state) =>
      (environmentId ? state.connectionStateByEnvironment[environmentId] : undefined) ?? "idle",
  );
  const applySnapshot = useThreadStore((state) => state.applySnapshot);
  const setConnectionState = useThreadStore((state) => state.setEnvironmentConnectionState);
  const project =
    environmentId && projectId && Object.keys(projectSummaryByKey).length > 0
      ? getProjectSummary(environmentId, projectId)
      : null;
  const threads =
    environmentId && projectId && Object.keys(threadSummaryByKey).length > 0
      ? listThreadSummariesForProject(environmentId, projectId)
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
      console.error("[mobile] failed to refresh project runtime", error);
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
          <Text style={styles.eyebrow}>{record?.label ?? "Environment"}</Text>
          <Text style={styles.title}>{project?.title ?? "Project"}</Text>
          <Text style={styles.copy}>{project?.workspaceRoot ?? "Loading project..."}</Text>
        </View>
        <View style={styles.actions}>
          <Pressable onPress={refresh} style={styles.primaryButton}>
            <Text style={styles.primaryButtonLabel}>
              {connectionState === "syncing" ? "Refreshing..." : "Refresh"}
            </Text>
          </Pressable>
          <Link
            asChild
            href={{
              pathname: "/environment/[environmentId]",
              params: {
                environmentId: environmentId ?? "",
              },
            }}
          >
            <Pressable style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonLabel}>Projects</Text>
            </Pressable>
          </Link>
        </View>
        <Text style={styles.sectionTitle}>Threads</Text>
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
});
