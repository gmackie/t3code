import type { ComponentType } from "react";

declare const require: (id: string) => unknown;

export interface BarcodeScanningResultLike {
  readonly data: string;
}

export interface ModernBarcodeScannerSubscription {
  readonly remove: () => void;
}

export interface ModernBarcodeScannerControls {
  readonly launchScanner: (options: {
    readonly barcodeTypes: ReadonlyArray<"qr">;
    readonly isGuidanceEnabled?: boolean;
    readonly isHighlightingEnabled?: boolean;
  }) => Promise<void>;
  readonly dismissScanner: () => Promise<void>;
  readonly onModernBarcodeScanned: (
    listener: (result: BarcodeScanningResultLike) => void,
  ) => ModernBarcodeScannerSubscription;
}

export interface CameraViewProps {
  readonly active?: boolean;
  readonly autofocus?: "on" | "off";
  readonly barcodeScannerSettings?: { readonly barcodeTypes: ReadonlyArray<"qr"> };
  readonly facing?: "back";
  readonly onCameraReady?: () => void;
  readonly onBarcodeScanned?:
    | ((result: BarcodeScanningResultLike) => void | Promise<void>)
    | undefined;
  readonly onMountError?: (event: { readonly message?: string }) => void;
  readonly style?: unknown;
}

export type CameraViewComponent = ComponentType<CameraViewProps> & {
  readonly isModernBarcodeScannerAvailable?: boolean;
  readonly launchScanner?: ModernBarcodeScannerControls["launchScanner"];
  readonly dismissScanner?: ModernBarcodeScannerControls["dismissScanner"];
  readonly onModernBarcodeScanned?: ModernBarcodeScannerControls["onModernBarcodeScanned"];
};

export interface CameraPermissionLike {
  readonly granted: boolean;
}

export interface ExpoCameraModule {
  readonly CameraView: CameraViewComponent;
  readonly useCameraPermissions: () => readonly [
    CameraPermissionLike | null,
    () => Promise<CameraPermissionLike | null>,
  ];
}

export function getEmbeddedBarcodeScannerCameraProps(): Pick<
  CameraViewProps,
  "autofocus" | "barcodeScannerSettings" | "facing"
> {
  return {
    // Expo maps "off" to continuous autofocus on iOS; "on" is one-shot focus lock.
    autofocus: "off",
    barcodeScannerSettings: { barcodeTypes: ["qr"] },
    facing: "back",
  };
}

export type LoadedExpoCameraModule =
  | {
      readonly available: true;
      readonly module: ExpoCameraModule;
    }
  | {
      readonly available: false;
      readonly errorMessage: string;
    };

export const missingCameraModuleMessage =
  "Camera scanning requires the latest T3 Code development build with expo-camera included.";

type RequireOptionalNativeModule = (moduleName: string) => unknown;

function isExpoCameraModule(value: unknown): value is ExpoCameraModule {
  if (value == null || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ExpoCameraModule>;
  return (
    typeof candidate.CameraView === "function" &&
    typeof candidate.useCameraPermissions === "function"
  );
}

export function getModernBarcodeScannerControls(
  cameraModule: ExpoCameraModule,
): ModernBarcodeScannerControls | null {
  const { CameraView } = cameraModule;
  if (
    CameraView.isModernBarcodeScannerAvailable !== true ||
    typeof CameraView.launchScanner !== "function" ||
    typeof CameraView.dismissScanner !== "function" ||
    typeof CameraView.onModernBarcodeScanned !== "function"
  ) {
    return null;
  }

  return {
    launchScanner: CameraView.launchScanner.bind(CameraView),
    dismissScanner: CameraView.dismissScanner.bind(CameraView),
    onModernBarcodeScanned: CameraView.onModernBarcodeScanned.bind(CameraView),
  };
}

function requireNativeCameraModule(): unknown {
  const expoModulesCore = require("expo-modules-core") as {
    readonly requireOptionalNativeModule?: RequireOptionalNativeModule;
  };
  if (typeof expoModulesCore.requireOptionalNativeModule !== "function") {
    return {};
  }
  return expoModulesCore.requireOptionalNativeModule("ExpoCamera");
}

export function loadExpoCameraModule(
  requireCamera: () => unknown = () => require("expo-camera"),
  requireNativeCamera: () => unknown = requireNativeCameraModule,
): LoadedExpoCameraModule {
  try {
    if (requireNativeCamera() == null) {
      return {
        available: false,
        errorMessage: missingCameraModuleMessage,
      };
    }

    const cameraModule = requireCamera();
    if (!isExpoCameraModule(cameraModule)) {
      return {
        available: false,
        errorMessage: missingCameraModuleMessage,
      };
    }

    return {
      available: true,
      module: cameraModule,
    };
  } catch {
    return {
      available: false,
      errorMessage: missingCameraModuleMessage,
    };
  }
}
