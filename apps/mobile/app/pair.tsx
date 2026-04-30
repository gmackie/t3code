import { Link, useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { pairEnvironmentFromUrl } from "../src/lib/pairing";
import { showPairingFailureAlert } from "../src/lib/pairingErrorAlert";
import { savePairedEnvironment } from "../src/state/environmentStore";
import { mobileTheme } from "../src/theme";

export default function PairScreen() {
  const router = useRouter();
  const [pairingUrl, setPairingUrl] = useState("");
  const [isPairing, setIsPairing] = useState(false);

  const handlePair = async () => {
    if (!pairingUrl.trim() || isPairing) {
      return;
    }

    setIsPairing(true);
    try {
      const paired = await pairEnvironmentFromUrl({
        pairingUrl,
      });
      await savePairedEnvironment({
        record: paired.record,
        sessionToken: paired.sessionToken,
      });
      router.replace("/settings");
    } catch (error) {
      showPairingFailureAlert(error);
    } finally {
      setIsPairing(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.title}>Pair a Tailnet environment</Text>
        <Text style={styles.copy}>
          Paste the pairing URL from the Mac. The app will exchange the one-time token for a saved
          bearer session on this device.
        </Text>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setPairingUrl}
          placeholder="http://100.88.12.4:3773/pair#token=..."
          placeholderTextColor={mobileTheme.colors.textMuted}
          style={styles.input}
          value={pairingUrl}
        />
        <Pressable onPress={handlePair} style={styles.button}>
          <Text style={styles.buttonLabel}>{isPairing ? "Pairing..." : "Pair Environment"}</Text>
        </Pressable>
        <Link asChild href="/scan-pairing">
          <Pressable style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonLabel}>Scan QR Code</Text>
          </Pressable>
        </Link>
        <Link href="/settings" style={styles.link}>
          Back to paired environments
        </Link>
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
    gap: mobileTheme.spacing.md,
    padding: mobileTheme.spacing.lg,
  },
  title: {
    color: mobileTheme.colors.text,
    fontSize: 28,
    fontWeight: "700",
  },
  copy: {
    color: mobileTheme.colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
  },
  input: {
    borderColor: "#d8c8b4",
    borderRadius: 16,
    borderWidth: 1,
    color: mobileTheme.colors.text,
    fontSize: 16,
    minHeight: 56,
    paddingHorizontal: mobileTheme.spacing.md,
    paddingVertical: mobileTheme.spacing.sm,
  },
  button: {
    alignItems: "center",
    backgroundColor: mobileTheme.colors.accent,
    borderRadius: 16,
    minHeight: 52,
    justifyContent: "center",
  },
  buttonLabel: {
    color: "#fffaf2",
    fontSize: 16,
    fontWeight: "700",
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "#fffaf2",
    borderRadius: 16,
    minHeight: 52,
    justifyContent: "center",
  },
  secondaryButtonLabel: {
    color: mobileTheme.colors.accent,
    fontSize: 16,
    fontWeight: "700",
  },
  link: {
    color: mobileTheme.colors.accent,
    fontSize: 15,
    fontWeight: "600",
  },
});
