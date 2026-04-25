import { ScrollView, StyleSheet, Text, View } from "react-native";

import type { MobileThreadDetail } from "../state/threadStore";
import { mobileTheme } from "../theme";

export function ThreadTranscript({
  thread,
  connectionState,
}: {
  readonly thread: MobileThreadDetail | null;
  readonly connectionState: "idle" | "syncing" | "ready" | "error";
}) {
  if (!thread) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>Thread snapshot unavailable.</Text>
        <Text style={styles.emptyCopy}>Refresh the environment to load transcript details.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>{thread.title}</Text>
        <Text style={styles.badge}>{connectionState}</Text>
      </View>
      <View style={styles.stub}>
        <Text style={styles.stubTitle}>Changed files</Text>
        <Text style={styles.stubCopy}>Diff summaries land here in Task 8.</Text>
      </View>
      {thread.messages.map((message) => (
        <View
          key={message.id}
          style={[styles.message, message.role === "assistant" ? styles.assistant : styles.user]}
        >
          <Text style={styles.role}>{message.role}</Text>
          <Text style={styles.body}>{message.text || "(empty message)"}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: mobileTheme.spacing.md,
    padding: mobileTheme.spacing.lg,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  title: {
    color: mobileTheme.colors.text,
    flex: 1,
    fontSize: 24,
    fontWeight: "700",
  },
  badge: {
    color: mobileTheme.colors.accent,
    fontSize: 13,
    fontWeight: "700",
    textTransform: "capitalize",
  },
  stub: {
    backgroundColor: mobileTheme.colors.surface,
    borderRadius: 18,
    gap: mobileTheme.spacing.xs,
    padding: mobileTheme.spacing.md,
  },
  stubTitle: {
    color: mobileTheme.colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  stubCopy: {
    color: mobileTheme.colors.textMuted,
    fontSize: 13,
  },
  message: {
    borderRadius: 18,
    gap: mobileTheme.spacing.xs,
    padding: mobileTheme.spacing.md,
  },
  assistant: {
    backgroundColor: mobileTheme.colors.surface,
  },
  user: {
    backgroundColor: "#e6dccf",
  },
  role: {
    color: mobileTheme.colors.accent,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  body: {
    color: mobileTheme.colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  emptyState: {
    backgroundColor: mobileTheme.colors.surface,
    borderRadius: 20,
    gap: mobileTheme.spacing.xs,
    margin: mobileTheme.spacing.lg,
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
