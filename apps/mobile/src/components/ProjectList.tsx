import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { MobileProjectSummary } from "../state/threadStore";
import { mobileTheme } from "../theme";

export function ProjectList({
  environmentId,
  projects,
}: {
  readonly environmentId: string;
  readonly projects: ReadonlyArray<MobileProjectSummary>;
}) {
  if (projects.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>No projects found yet.</Text>
        <Text style={styles.emptyCopy}>
          Refresh this environment after T3 Code has loaded its desktop project list.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.list}>
      {projects.map((project) => (
        <Link
          asChild
          href={{
            pathname: "/environment/[environmentId]/project/[projectId]",
            params: {
              environmentId,
              projectId: project.projectId,
            },
          }}
          key={`${project.environmentId}:${project.projectId}`}
        >
          <Pressable style={styles.row}>
            <View style={styles.rowHeader}>
              <Text style={styles.title}>{project.title}</Text>
              <Text style={styles.count}>{project.activeThreadCount}</Text>
            </View>
            <Text style={styles.meta}>{project.workspaceRoot}</Text>
          </Pressable>
        </Link>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: mobileTheme.spacing.sm,
  },
  row: {
    backgroundColor: mobileTheme.colors.surface,
    borderRadius: 18,
    gap: mobileTheme.spacing.xs,
    padding: mobileTheme.spacing.md,
  },
  rowHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: mobileTheme.spacing.sm,
    justifyContent: "space-between",
  },
  title: {
    color: mobileTheme.colors.text,
    flex: 1,
    fontSize: 17,
    fontWeight: "700",
  },
  count: {
    color: mobileTheme.colors.accent,
    fontSize: 13,
    fontWeight: "700",
  },
  meta: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
  },
  emptyState: {
    backgroundColor: mobileTheme.colors.surface,
    borderRadius: 20,
    gap: mobileTheme.spacing.sm,
    padding: mobileTheme.spacing.lg,
  },
  emptyTitle: {
    color: mobileTheme.colors.text,
    fontSize: 18,
    fontWeight: "700",
  },
  emptyCopy: {
    color: mobileTheme.colors.textMuted,
    fontSize: 14,
  },
});
