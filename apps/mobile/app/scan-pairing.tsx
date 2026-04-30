import { Link, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  type BarcodeScanningResultLike,
  type ExpoCameraModule,
  getEmbeddedBarcodeScannerCameraProps,
  getModernBarcodeScannerControls,
  loadExpoCameraModule,
} from "../src/lib/cameraModule";
import { pairEnvironmentFromUrl } from "../src/lib/pairing";
import { showPairingFailureAlert } from "../src/lib/pairingErrorAlert";
import { normalizeScannedPairingUrl } from "../src/lib/scannedPairing";
import { savePairedEnvironment } from "../src/state/environmentStore";
import { mobileTheme } from "../src/theme";

export default function ScanPairingScreen() {
  const [cameraModule] = useState(() => loadExpoCameraModule());

  if (!cameraModule.available) {
    return <CameraUnavailable errorMessage={cameraModule.errorMessage} />;
  }

  return <CameraScanner cameraModule={cameraModule.module} />;
}

function CameraScanner({ cameraModule }: { readonly cameraModule: ExpoCameraModule }) {
  const router = useRouter();
  const { CameraView, useCameraPermissions } = cameraModule;
  const [modernScanner] = useState(() => getModernBarcodeScannerControls(cameraModule));
  const [permission, requestPermission] = useCameraPermissions();
  const [isPairing, setIsPairing] = useState(false);
  const [cameraStatus, setCameraStatus] = useState("Starting camera...");
  const scanningRef = useRef(false);
  const hasLaunchedModernScannerRef = useRef(false);

  useEffect(() => {
    if (!permission) {
      void requestPermission();
    }
  }, [permission, requestPermission]);

  const handleScan = useCallback(
    async (result: BarcodeScanningResultLike) => {
      if (scanningRef.current) {
        return;
      }

      scanningRef.current = true;
      setIsPairing(true);
      setCameraStatus("QR code scanned. Connecting...");
      try {
        const pairingUrl = normalizeScannedPairingUrl(result.data);
        if (modernScanner) {
          void modernScanner.dismissScanner().catch(() => undefined);
        }
        const paired = await pairEnvironmentFromUrl({ pairingUrl });
        await savePairedEnvironment({
          record: paired.record,
          sessionToken: paired.sessionToken,
        });
        router.replace({
          pathname: "/environment/[environmentId]",
          params: {
            environmentId: paired.record.environmentId,
          },
        });
      } catch (error) {
        showPairingFailureAlert(error);
        scanningRef.current = false;
        setIsPairing(false);
      }
    },
    [modernScanner, router],
  );

  useEffect(() => {
    if (!modernScanner) {
      return;
    }

    const subscription = modernScanner.onModernBarcodeScanned(handleScan);
    return () => {
      subscription.remove();
      void modernScanner.dismissScanner().catch(() => undefined);
    };
  }, [handleScan, modernScanner]);

  const launchModernScanner = useCallback(async () => {
    if (!modernScanner || scanningRef.current) {
      return;
    }

    try {
      setCameraStatus("Opening native QR scanner...");
      await modernScanner.launchScanner({
        barcodeTypes: ["qr"],
        isGuidanceEnabled: true,
        isHighlightingEnabled: true,
      });
      setCameraStatus("Native scanner open. Point it at the desktop QR code.");
    } catch {
      setCameraStatus("Native scanner could not open. Use the camera frame below.");
      hasLaunchedModernScannerRef.current = false;
    }
  }, [modernScanner]);

  const handleCameraReady = useCallback(() => {
    setCameraStatus(
      modernScanner
        ? "Camera ready. Use the native scanner or hold the QR code inside the frame."
        : "Camera ready. Hold the QR code inside the frame.",
    );
  }, [modernScanner]);

  const permissionGranted = permission?.granted === true;

  useEffect(() => {
    if (!permissionGranted || !modernScanner || hasLaunchedModernScannerRef.current) {
      return;
    }

    hasLaunchedModernScannerRef.current = true;
    void launchModernScanner();
  }, [launchModernScanner, modernScanner, permissionGranted]);

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
            {...getEmbeddedBarcodeScannerCameraProps()}
            onCameraReady={handleCameraReady}
            onBarcodeScanned={handleScan}
            style={styles.camera}
          />
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
        {permissionGranted ? (
          <View pointerEvents="none" style={styles.cameraOverlay}>
            <View style={styles.reticle} />
            <Text style={styles.cameraStatus}>{isPairing ? "Pairing..." : cameraStatus}</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.actions}>
        {permissionGranted && modernScanner ? (
          <Pressable onPress={launchModernScanner} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonLabel}>Open Native Scanner</Text>
          </Pressable>
        ) : null}
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

function CameraUnavailable({ errorMessage }: { readonly errorMessage: string }) {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Pair Environment</Text>
        <Text style={styles.title}>Install the latest dev build</Text>
        <Text style={styles.copy}>
          {errorMessage} Install the newest iOS build, then reopen this scanner.
        </Text>
      </View>

      <View style={styles.unavailableState}>
        <Text style={styles.permissionTitle}>Camera module unavailable.</Text>
        <Text style={styles.permissionCopy}>
          The current native app was built before QR scanning support was added.
        </Text>
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
    position: "relative",
  },
  camera: {
    ...StyleSheet.absoluteFillObject,
  },
  cameraOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
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
  cameraStatus: {
    bottom: mobileTheme.spacing.xl,
    color: "#fffaf2",
    fontSize: 13,
    fontWeight: "700",
    left: mobileTheme.spacing.lg,
    lineHeight: 18,
    opacity: 0.9,
    position: "absolute",
    right: mobileTheme.spacing.lg,
    textAlign: "center",
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
  unavailableState: {
    alignItems: "center",
    backgroundColor: "#1d1914",
    borderRadius: 32,
    gap: mobileTheme.spacing.md,
    justifyContent: "center",
    minHeight: 260,
    padding: mobileTheme.spacing.lg,
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
