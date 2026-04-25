import { Link, useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  hydrateEnvironmentStore,
  listEnvironmentRecords,
  useEnvironmentStore,
} from "../src/state/environmentStore";
import { mobileTheme } from "../src/theme";

export default function SettingsScreen() {
  const recordsById = useEnvironmentStore((state) => state.recordsById);
  const environments = Object.keys(recordsById).length > 0 ? listEnvironmentRecords() : [];

  useFocusEffect(
    useCallback(() => {
      void hydrateEnvironmentStore().catch((error) => {
        console.error("[mobile] failed to hydrate environments", error);
      });
    }, []),
  );

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Device Settings</Text>
        <Text style={styles.title}>Paired environments</Text>
        <Text style={styles.copy}>
          Mobile keeps environment metadata in AsyncStorage and bearer session secrets in Secure
          Store.
        </Text>
      </View>
      <View style={styles.list}>
        {environments.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No paired environments yet.</Text>
            <Text style={styles.emptyCopy}>Add one from a pairing URL on your Tailnet.</Text>
          </View>
        ) : (
          environments.map((environment) => (
            <View key={environment.environmentId} style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{environment.label}</Text>
                <Text style={styles.rowMeta}>{environment.httpBaseUrl}</Text>
              </View>
            </View>
          ))
        )}
      </View>
      <Link asChild href="/pair">
        <Pressable style={styles.button}>
          <Text style={styles.buttonLabel}>Add Pairing URL</Text>
        </Pressable>
      </Link>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: mobileTheme.colors.background,
    gap: mobileTheme.spacing.lg,
    padding: mobileTheme.spacing.lg,
  },
  header: {
    gap: mobileTheme.spacing.sm,
  },
  eyebrow: {
    color: mobileTheme.colors.accent,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  title: {
    color: mobileTheme.colors.text,
    fontSize: 30,
    fontWeight: "700",
  },
  copy: {
    color: mobileTheme.colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
  },
  list: {
    flex: 1,
    gap: mobileTheme.spacing.sm,
  },
  emptyState: {
    backgroundColor: mobileTheme.colors.surface,
    borderRadius: 24,
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
    fontSize: 15,
  },
  row: {
    backgroundColor: mobileTheme.colors.surface,
    borderRadius: 20,
    padding: mobileTheme.spacing.md,
  },
  rowText: {
    gap: mobileTheme.spacing.xs,
  },
  rowTitle: {
    color: mobileTheme.colors.text,
    fontSize: 17,
    fontWeight: "700",
  },
  rowMeta: {
    color: mobileTheme.colors.textMuted,
    fontSize: 14,
  },
  button: {
    alignItems: "center",
    backgroundColor: mobileTheme.colors.accent,
    borderRadius: 16,
    justifyContent: "center",
    minHeight: 54,
  },
  buttonLabel: {
    color: "#fffaf2",
    fontSize: 16,
    fontWeight: "700",
  },
});
