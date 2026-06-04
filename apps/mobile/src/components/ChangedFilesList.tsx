import { Pressable, StyleSheet, Text, View } from "react-native";

import { mobileTheme } from "../theme";

export function ChangedFilesList({
  files,
  selectedPath,
  onSelect,
}: {
  readonly files: ReadonlyArray<{ readonly path: string; readonly summary?: string }>;
  readonly selectedPath?: string | null;
  readonly onSelect: (path: string) => void;
}) {
  if (files.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Changed files</Text>
      <View style={styles.list}>
        {files.map((file) => {
          const selected = file.path === selectedPath;
          return (
            <Pressable
              key={file.path}
              onPress={() => onSelect(file.path)}
              style={[styles.row, selected ? styles.selectedRow : null]}
            >
              <Text numberOfLines={1} style={styles.path}>
                {file.path}
              </Text>
              {file.summary ? <Text style={styles.summary}>{file.summary}</Text> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: mobileTheme.colors.surface,
    borderRadius: 8,
    gap: mobileTheme.spacing.sm,
    padding: mobileTheme.spacing.md,
  },
  title: {
    color: mobileTheme.colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  list: {
    gap: mobileTheme.spacing.xs,
  },
  row: {
    borderColor: "#d8c8b4",
    borderRadius: 8,
    borderWidth: 1,
    gap: 2,
    padding: mobileTheme.spacing.sm,
  },
  selectedRow: {
    borderColor: mobileTheme.colors.accent,
  },
  path: {
    color: mobileTheme.colors.text,
    fontSize: 13,
    fontWeight: "700",
  },
  summary: {
    color: mobileTheme.colors.textMuted,
    fontSize: 12,
  },
});
