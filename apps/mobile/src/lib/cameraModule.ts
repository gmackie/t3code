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

export function loadExpoCameraModule(
  requireCamera: () => unknown = () => require("expo-camera"),
): LoadedExpoCameraModule {
  try {
    return {
      available: true,
      module: requireCamera() as ExpoCameraModule,
    };
  } catch {
    return {
      available: false,
      errorMessage: missingCameraModuleMessage,
    };
  }
}
