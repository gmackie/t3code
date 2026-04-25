import { type BarcodeScanningResult, CameraView, useCameraPermissions } from "expo-camera";
import { Link, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { pairEnvironmentFromUrl } from "../src/lib/pairing";
import { normalizeScannedPairingUrl } from "../src/lib/scannedPairing";
import { savePairedEnvironment } from "../src/state/environmentStore";
import { mobileTheme } from "../src/theme";

export default function ScanPairingScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [isPairing, setIsPairing] = useState(false);

  useEffect(() => {
    if (!permission) {
      void requestPermission();
    }
  }, [permission, requestPermission]);

  const handleScan = useCallback(
    async (result: BarcodeScanningResult) => {
      if (isPairing) {
        return;
      }

      setIsPairing(true);
      try {
        const pairingUrl = normalizeScannedPairingUrl(result.data);
        const paired = await pairEnvironmentFromUrl({ pairingUrl });
        await savePairedEnvironment({
          record: paired.record,
          sessionToken: paired.sessionToken,
        });
        router.replace("/settings");
      } catch (error) {
        Alert.alert("Pairing failed", error instanceof Error ? error.message : String(error));
        setIsPairing(false);
      }
    },
    [isPairing, router],
  );

  const permissionGranted = permission?.granted === true;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Pair Environment</Text>
        <Text style={styles.title}>Scan the desktop QR code</Text>
        <Text style={styles.copy}>
          Create a link in T3 Code on your Mac, then point this camera at the pairing QR code.
        </Text>
      </View>

      <View style={styles.scannerFrame}>
        {permissionGranted ? (
          <CameraView
            active={!isPairing}
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            facing="back"
            onBarcodeScanned={isPairing ? undefined : handleScan}
            style={styles.camera}
          >
            <View style={styles.reticle} />
          </CameraView>
        ) : (
          <View style={styles.permissionState}>
            <Text style={styles.permissionTitle}>
              {permission ? "Camera access is needed." : "Checking camera permission..."}
            </Text>
            <Text style={styles.permissionCopy}>
              T3 Code uses the camera only to scan pairing QR codes from your desktop.
            </Text>
            <Pressable onPress={requestPermission} style={styles.secondaryButton}>
              <Text style={styles.secondaryButtonLabel}>Allow Camera Access</Text>
            </Pressable>
          </View>
        )}
      </View>

      <View style={styles.actions}>
        <Link asChild href="/pair">
          <Pressable style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonLabel}>Enter URL Manually</Text>
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
  scannerFrame: {
    backgroundColor: "#1d1914",
    borderRadius: 32,
    flex: 1,
    overflow: "hidden",
  },
  camera: {
    flex: 1,
    justifyContent: "center",
    padding: mobileTheme.spacing.xl,
  },
  reticle: {
    alignSelf: "center",
    borderColor: "#fffaf2",
    borderRadius: 28,
    borderWidth: 3,
    height: 230,
    opacity: 0.9,
    width: 230,
  },
  permissionState: {
    alignItems: "center",
    flex: 1,
    gap: mobileTheme.spacing.md,
    justifyContent: "center",
    padding: mobileTheme.spacing.lg,
  },
  permissionTitle: {
    color: "#fffaf2",
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
  },
  permissionCopy: {
    color: "#d8c8b4",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  actions: {
    alignItems: "center",
    gap: mobileTheme.spacing.md,
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: mobileTheme.colors.surface,
    borderRadius: 16,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: mobileTheme.spacing.lg,
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
