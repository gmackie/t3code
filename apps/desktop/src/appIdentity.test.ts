import { describe, expect, it } from "vitest";

import { getDesktopRuntimeIdentity } from "./appIdentity.js";

describe("getDesktopRuntimeIdentity", () => {
  it("assigns a distinct runtime identity to packaged gmacko builds", () => {
    expect(
      getDesktopRuntimeIdentity({
        isDevelopment: false,
        appDisplayName: "T3 Code (gmacko)",
      }),
    ).toEqual({
      appId: "com.t3tools.t3code.gmacko",
      appUserModelId: "com.t3tools.t3code.gmacko",
      displayName: "T3 Code (gmacko)",
      packageName: "t3code-gmacko",
      stateDirName: "userdata-gmacko",
      updaterCacheDirName: "t3code-gmacko-updater",
      userDataDirName: "t3code-gmacko",
    });
  });

  it("detects packaged gmacko builds by package name", () => {
    expect(
      getDesktopRuntimeIdentity({
        isDevelopment: false,
        appDisplayName: "t3code-gmacko",
        packageName: "t3code-gmacko",
      }),
    ).toEqual({
      appId: "com.t3tools.t3code.gmacko",
      appUserModelId: "com.t3tools.t3code.gmacko",
      displayName: "T3 Code (gmacko)",
      packageName: "t3code-gmacko",
      stateDirName: "userdata-gmacko",
      updaterCacheDirName: "t3code-gmacko-updater",
      userDataDirName: "t3code-gmacko",
    });
  });

  it("keeps the default runtime identity for alpha builds", () => {
    expect(
      getDesktopRuntimeIdentity({
        isDevelopment: false,
        appDisplayName: "T3 Code (Alpha)",
      }),
    ).toEqual({
      appId: "com.t3tools.t3code",
      appUserModelId: "com.t3tools.t3code",
      displayName: "T3 Code (Alpha)",
      packageName: "t3code",
      stateDirName: "userdata",
      updaterCacheDirName: "t3code-updater",
      userDataDirName: "t3code",
    });
  });

  it("uses the dev user-data namespace for development runs", () => {
    expect(
      getDesktopRuntimeIdentity({
        isDevelopment: true,
        appDisplayName: "T3 Code (Dev)",
      }),
    ).toEqual({
      appId: "com.t3tools.t3code",
      appUserModelId: "com.t3tools.t3code",
      displayName: "T3 Code (Dev)",
      packageName: "t3code",
      stateDirName: "userdata-dev",
      updaterCacheDirName: "t3code-updater",
      userDataDirName: "t3code-dev",
    });
  });
});
