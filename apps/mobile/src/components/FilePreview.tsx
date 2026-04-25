import { StyleSheet, Text, View } from "react-native";

import { mobileTheme } from "../theme";
import { createFilePreviewModel } from "./filePreviewModel";

export function FilePreview({
  path,
  language,
  contents,
}: {
  readonly path: string;
  readonly language?: string;
  readonly contents: string;
}) {
  const preview = createFilePreviewModel({ path, ...(language ? { language } : {}), contents });

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text numberOfLines={1} style={styles.path}>
          {preview.path}
        </Text>
        {preview.language ? <Text style={styles.language}>{preview.language}</Text> : null}
      </View>
      <View style={styles.body}>
        {preview.lines.map((line) => (
          <Text key={line.id} numberOfLines={1} style={styles.line}>
            {line.text || " "}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#17130f",
    borderRadius: 8,
    overflow: "hidden",
  },
  header: {
    alignItems: "center",
    backgroundColor: "#2a2119",
    flexDirection: "row",
    gap: mobileTheme.spacing.sm,
    justifyContent: "space-between",
    paddingHorizontal: mobileTheme.spacing.md,
    paddingVertical: mobileTheme.spacing.sm,
  },
  path: {
    color: "#fffaf2",
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
  },
  language: {
    color: "#d8c8b4",
    fontSize: 12,
    textTransform: "uppercase",
  },
  body: {
    padding: mobileTheme.spacing.md,
  },
  line: {
    color: "#f4efe5",
    fontFamily: "Courier",
    fontSize: 12,
    lineHeight: 18,
  },
});
