import { StatusBar, StyleSheet, Text, View } from "react-native";
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
});
