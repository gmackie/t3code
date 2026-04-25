import { ScrollView, StyleSheet, Text, View } from "react-native";

import type { MobileThreadDetail } from "../state/threadStore";
import { mobileTheme } from "../theme";
import { ChangedFilesList } from "./ChangedFilesList";
import { FilePreview } from "./FilePreview";

export function ThreadTranscript({
  thread,
  connectionState,
  selectedFilePath,
  onSelectFile,
}: {
  readonly thread: MobileThreadDetail | null;
  readonly connectionState: "idle" | "syncing" | "ready" | "error";
  readonly selectedFilePath?: string | null;
  readonly onSelectFile?: (path: string) => void;
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
      <ChangedFilesList
        files={thread.changedFiles}
        onSelect={onSelectFile ?? (() => undefined)}
        selectedPath={selectedFilePath ?? null}
      />
      {selectedFilePath ? (
        <FilePreview
          contents={
            thread.changedFiles.find((file) => file.path === selectedFilePath)?.summary ??
            "Preview unavailable from the current snapshot."
          }
          path={selectedFilePath}
        />
      ) : null}
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
