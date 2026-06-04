import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";

import type { MobileInboxItem } from "../state/threadStore";
import { mobileTheme } from "../theme";

export function InboxList({ items }: { readonly items: ReadonlyArray<MobileInboxItem> }) {
  if (items.length === 0) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>Inbox is clear.</Text>
        <Text style={styles.emptyCopy}>
          Approvals, plan picks, and blocked inputs will land here.
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
      {items.map((item) => (
        <Link
          asChild
          href={{
            pathname: "/thread/[threadId]",
            params: {
              threadId: item.threadId,
              environmentId: item.environmentId,
            },
          }}
          key={`${item.environmentId}:${item.threadId}:${item.kind}`}
        >
          <Pressable style={styles.row}>
            <Text style={styles.kind}>{item.kind.replace("-", " ")}</Text>
            <Text style={styles.meta}>{item.threadId}</Text>
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
  kind: {
    color: mobileTheme.colors.text,
    fontSize: 17,
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
