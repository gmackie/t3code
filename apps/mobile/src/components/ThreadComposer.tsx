import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { mobileTheme } from "../theme";

export function ThreadComposer({
  disabled,
  onSubmit,
}: {
  readonly disabled?: boolean;
  readonly onSubmit: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || disabled || submitting) {
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit(trimmed);
      setText("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <TextInput
        editable={!disabled && !submitting}
        multiline
        onChangeText={setText}
        placeholder="Reply to this thread..."
        placeholderTextColor={mobileTheme.colors.textMuted}
        style={styles.input}
        value={text}
      />
      <Pressable
        disabled={disabled || submitting || !text.trim()}
        onPress={submit}
        style={[styles.button, disabled || submitting || !text.trim() ? styles.disabled : null]}
      >
        <Text style={styles.buttonLabel}>{submitting ? "Sending" : "Send"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: mobileTheme.colors.surface,
    borderTopColor: "#d8c8b4",
    borderTopWidth: 1,
    gap: mobileTheme.spacing.sm,
    padding: mobileTheme.spacing.md,
  },
  input: {
    borderColor: "#d8c8b4",
    borderRadius: 8,
    borderWidth: 1,
    color: mobileTheme.colors.text,
    minHeight: 88,
    padding: mobileTheme.spacing.sm,
    textAlignVertical: "top",
  },
  button: {
    alignItems: "center",
    backgroundColor: mobileTheme.colors.accent,
    borderRadius: 8,
    justifyContent: "center",
    minHeight: 44,
  },
  disabled: {
    opacity: 0.45,
  },
  buttonLabel: {
    color: "#fffaf2",
    fontSize: 15,
    fontWeight: "700",
  },
});
