import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { MobileThreadSummary } from "../state/threadStore";
import { mobileTheme } from "../theme";

export function ThreadList({ threads }: { readonly threads: ReadonlyArray<MobileThreadSummary> }) {
  if (threads.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>No thread snapshots yet.</Text>
        <Text style={styles.emptyCopy}>
          Pair an environment, then refresh to load its thread list.
        </Text>
        <View style={styles.emptyActions}>
          <Link asChild href="/scan-pairing">
            <Pressable style={styles.primaryButton}>
              <Text style={styles.primaryButtonLabel}>Scan QR</Text>
            </Pressable>
          </Link>
          <Link asChild href="/pair">
            <Pressable style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonLabel}>Enter URL</Text>
            </Pressable>
          </Link>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.list}>
      {threads.map((thread) => (
        <Link
          asChild
          href={{
            pathname: "/thread/[threadId]",
            params: {
              threadId: thread.threadId,
              environmentId: thread.environmentId,
            },
          }}
          key={`${thread.environmentId}:${thread.threadId}`}
        >
          <Pressable style={styles.row}>
            <View style={styles.rowHeader}>
              <Text style={styles.title}>{thread.title}</Text>
              <Text style={styles.status}>{thread.sessionStatus}</Text>
            </View>
            <Text style={styles.meta}>{thread.latestUserMessageAt ?? thread.updatedAt}</Text>
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
  status: {
    color: mobileTheme.colors.accent,
    fontSize: 13,
    fontWeight: "700",
    textTransform: "capitalize",
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
  emptyActions: {
    flexDirection: "row",
    gap: mobileTheme.spacing.sm,
    marginTop: mobileTheme.spacing.sm,
  },
  primaryButton: {
    backgroundColor: mobileTheme.colors.accent,
    borderRadius: 999,
    paddingHorizontal: mobileTheme.spacing.md,
    paddingVertical: mobileTheme.spacing.sm,
  },
  primaryButtonLabel: {
    color: "#fffaf2",
    fontSize: 14,
    fontWeight: "700",
  },
  secondaryButton: {
    borderColor: mobileTheme.colors.text,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: mobileTheme.spacing.md,
    paddingVertical: mobileTheme.spacing.sm,
  },
  secondaryButtonLabel: {
    color: mobileTheme.colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
});
