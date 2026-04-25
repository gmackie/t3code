import type { ProviderApprovalDecision } from "@t3tools/contracts";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { mobileTheme } from "../theme";

export function ApprovalCard({
  requestId,
  summary,
  disabled,
  onRespond,
}: {
  readonly requestId: string | null;
  readonly summary: string | null;
  readonly disabled?: boolean;
  readonly onRespond: (requestId: string, decision: ProviderApprovalDecision) => Promise<void>;
}) {
  if (!requestId) {
    return null;
  }

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>Approval Required</Text>
      <Text style={styles.summary}>{summary ?? "The agent is waiting for approval."}</Text>
      <View style={styles.actions}>
        <Pressable
          disabled={disabled}
          onPress={() => void onRespond(requestId, "accept")}
          style={[styles.acceptButton, disabled ? styles.disabled : null]}
        >
          <Text style={styles.acceptLabel}>Accept</Text>
        </Pressable>
        <Pressable
          disabled={disabled}
          onPress={() => void onRespond(requestId, "decline")}
          style={[styles.declineButton, disabled ? styles.disabled : null]}
        >
          <Text style={styles.declineLabel}>Decline</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#fff2df",
    borderColor: "#d99b64",
    borderRadius: 8,
    borderWidth: 1,
    gap: mobileTheme.spacing.sm,
    padding: mobileTheme.spacing.md,
  },
  eyebrow: {
    color: mobileTheme.colors.accent,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  summary: {
    color: mobileTheme.colors.text,
    fontSize: 15,
    lineHeight: 21,
  },
  actions: {
    flexDirection: "row",
    gap: mobileTheme.spacing.sm,
  },
  acceptButton: {
    alignItems: "center",
    backgroundColor: mobileTheme.colors.accent,
    borderRadius: 8,
    flex: 1,
    justifyContent: "center",
    minHeight: 42,
  },
  acceptLabel: {
    color: "#fffaf2",
    fontWeight: "700",
  },
  declineButton: {
    alignItems: "center",
    borderColor: "#d8c8b4",
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 42,
  },
  declineLabel: {
    color: mobileTheme.colors.text,
    fontWeight: "700",
  },
  disabled: {
    opacity: 0.45,
  },
});
