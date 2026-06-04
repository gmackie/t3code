import { describe, expect, it } from "vitest";

import { resolveDesktopRuntimeIdentity } from "./runtimeIdentity";

describe("resolveDesktopRuntimeIdentity", () => {
  it("keeps development on the existing local identity", () => {
    expect(
      resolveDesktopRuntimeIdentity({
        isDevelopment: true,
        appVersion: "0.0.20-gmacko.202604170930",
      }),
    ).toMatchObject({
      baseDirName: ".t3",
      stateDirName: "userdata",
      userDataDirName: "t3code-dev",
      appUserModelId: "com.t3tools.t3code.dev",
    });
  });

  it("keeps stable and nightly on the existing default environment", () => {
    expect(
      resolveDesktopRuntimeIdentity({
        isDevelopment: false,
        appVersion: "0.0.20-nightly.20260417.1",
      }),
    ).toMatchObject({
      updateChannel: "nightly",
      baseDirName: ".t3",
      stateDirName: "userdata",
      userDataDirName: "t3code",
      appUserModelId: "com.t3tools.t3code",
    });
  });

  it("isolates gmacko into its own app and server state paths", () => {
    expect(
      resolveDesktopRuntimeIdentity({
        isDevelopment: false,
        appVersion: "0.0.20-gmacko.202604170930",
      }),
    ).toEqual({
      updateChannel: "gmacko",
      baseDirName: ".t3-gmacko",
      stateDirName: "userdata-gmacko",
      userDataDirName: "t3code-gmacko",
      legacyUserDataDirName: "T3 Code (Gmacko)",
      appUserModelId: "com.t3tools.t3code.gmacko",
      linuxDesktopEntryName: "t3code-gmacko.desktop",
      linuxWmClass: "t3code-gmacko",
    });
  });
});
