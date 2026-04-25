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
    gap: mobileTheme.spacing.xs,
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
