import type { ComponentType, ReactNode } from "react";

declare const require: (id: string) => unknown;

export interface BarcodeScanningResultLike {
  readonly data: string;
}

export interface CameraViewProps {
  readonly active?: boolean;
  readonly barcodeScannerSettings?: { readonly barcodeTypes: ReadonlyArray<"qr"> };
  readonly children?: ReactNode;
  readonly facing?: "back";
  readonly onBarcodeScanned?:
    | ((result: BarcodeScanningResultLike) => void | Promise<void>)
    | undefined;
  readonly style?: unknown;
}

export interface CameraPermissionLike {
  readonly granted: boolean;
}

export interface ExpoCameraModule {
  readonly CameraView: ComponentType<CameraViewProps>;
  readonly useCameraPermissions: () => readonly [
    CameraPermissionLike | null,
    () => Promise<CameraPermissionLike | null>,
  ];
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
