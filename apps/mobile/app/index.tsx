import { Link } from "expo-router";
import { StatusBar, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { mobileTheme } from "../src/theme";

export default function HomeScreen() {
  return (
    <SafeAreaView edges={["top", "right", "bottom", "left"]} style={styles.screen}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.card}>
        <Text style={styles.eyebrow}>T3 Code Mobile</Text>
        <Text style={styles.title}>Tailnet control, native shell.</Text>
        <Text style={styles.copy}>
          Pair this app to a Mac on your Tailnet, monitor active threads, and recover stuck runs
          without leaving your phone.
        </Text>
        <View style={styles.actions}>
          <Link asChild href="/pair">
            <Pressable style={styles.primaryAction}>
              <Text style={styles.primaryActionLabel}>Pair Environment</Text>
            </Pressable>
          </Link>
          <Link asChild href="/settings">
            <Pressable style={styles.secondaryAction}>
              <Text style={styles.secondaryActionLabel}>View Saved Environments</Text>
            </Pressable>
          </Link>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: mobileTheme.colors.background,
    justifyContent: "center",
    padding: mobileTheme.spacing.lg,
  },
  card: {
    backgroundColor: mobileTheme.colors.surface,
    borderRadius: 28,
    padding: mobileTheme.spacing.lg,
    gap: mobileTheme.spacing.sm,
    shadowColor: "#2f2416",
    shadowOpacity: 0.08,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
  },
  eyebrow: {
    color: mobileTheme.colors.accent,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  title: {
    color: mobileTheme.colors.text,
    fontSize: 32,
    fontWeight: "700",
    lineHeight: 36,
  },
  copy: {
    color: mobileTheme.colors.textMuted,
    fontSize: 16,
    lineHeight: 24,
  },
  actions: {
    gap: mobileTheme.spacing.sm,
    marginTop: mobileTheme.spacing.sm,
  },
  primaryAction: {
    alignItems: "center",
    backgroundColor: mobileTheme.colors.accent,
    borderRadius: 16,
    justifyContent: "center",
    minHeight: 52,
  },
  primaryActionLabel: {
    color: "#fffaf2",
    fontSize: 16,
    fontWeight: "700",
  },
  secondaryAction: {
    alignItems: "center",
    borderColor: "#d8c8b4",
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 52,
  },
  secondaryActionLabel: {
    color: mobileTheme.colors.text,
    fontSize: 15,
    fontWeight: "600",
  },
});
