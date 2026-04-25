import { describe, expect, it } from "vitest";

import { loadExpoCameraModule } from "./cameraModule";

describe("loadExpoCameraModule", () => {
  it("reports unavailable when the native camera module is missing", () => {
    const loaded = loadExpoCameraModule(
      () => {
        throw new Error("Cannot find native module 'ExpoCamera'");
      },
      () => ({}),
    );

    expect(loaded).toEqual({
      available: false,
      errorMessage:
        "Camera scanning requires the latest T3 Code development build with expo-camera included.",
    });
  });

  it("returns the loaded camera module when expo-camera can be required", () => {
    const cameraModule = {
      CameraView: () => null,
      useCameraPermissions: () => [null, () => undefined],
    };

    const loaded = loadExpoCameraModule(
      () => cameraModule,
      () => ({}),
    );

    expect(loaded).toEqual({
      available: true,
      module: cameraModule,
    });
  });

  it("reports unavailable when expo-camera resolves without the camera view API", () => {
    const loaded = loadExpoCameraModule(
      () => undefined,
      () => ({}),
    );

    expect(loaded).toEqual({
      available: false,
      errorMessage:
        "Camera scanning requires the latest T3 Code development build with expo-camera included.",
    });
  });

  it("does not require expo-camera when the native ExpoCamera module is missing", () => {
    let didRequireCamera = false;
    const loaded = loadExpoCameraModule(
      () => {
        didRequireCamera = true;
        return {
          CameraView: () => null,
          useCameraPermissions: () => [null, () => undefined],
        };
      },
      () => null,
    );

    expect(didRequireCamera).toBe(false);
    expect(loaded).toEqual({
      available: false,
      errorMessage:
        "Camera scanning requires the latest T3 Code development build with expo-camera included.",
    });
  });
});
