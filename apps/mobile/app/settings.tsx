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
            <Text style={styles.emptyCopy}>Scan a pairing QR code from your Mac.</Text>
          </View>
        ) : (
          environments.map((environment) => (
            <Link
              asChild
              href={{
                pathname: "/environment/[environmentId]",
                params: {
                  environmentId: environment.environmentId,
                },
              }}
              key={environment.environmentId}
            >
              <Pressable style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{environment.label}</Text>
                  <Text style={styles.rowMeta}>{environment.httpBaseUrl}</Text>
                </View>
                <Text style={styles.rowChevron}>Open</Text>
              </Pressable>
            </Link>
          ))
        )}
      </View>
      <Link asChild href="/scan-pairing">
        <Pressable style={styles.button}>
          <Text style={styles.buttonLabel}>Scan Pairing QR</Text>
        </Pressable>
      </Link>
      <Link asChild href="/pair">
        <Pressable style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonLabel}>Enter URL Manually</Text>
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
    alignItems: "center",
    backgroundColor: mobileTheme.colors.surface,
    borderRadius: 20,
    flexDirection: "row",
    gap: mobileTheme.spacing.sm,
    justifyContent: "space-between",
    padding: mobileTheme.spacing.md,
  },
  rowText: {
    flex: 1,
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
  rowChevron: {
    color: mobileTheme.colors.accent,
    fontSize: 13,
    fontWeight: "700",
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
  secondaryButton: {
    alignItems: "center",
    backgroundColor: mobileTheme.colors.surface,
    borderRadius: 16,
    justifyContent: "center",
    minHeight: 54,
  },
  secondaryButtonLabel: {
    color: mobileTheme.colors.accent,
    fontSize: 16,
    fontWeight: "700",
  },
});
