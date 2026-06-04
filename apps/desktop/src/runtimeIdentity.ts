import type { DesktopUpdateChannel } from "@t3tools/contracts";

import { resolveDefaultDesktopUpdateChannel } from "./updateChannels";

export interface DesktopRuntimeIdentity {
  readonly updateChannel: DesktopUpdateChannel;
  readonly baseDirName: string;
  readonly stateDirName: string;
  readonly userDataDirName: string;
  readonly legacyUserDataDirName: string;
  readonly appUserModelId: string;
  readonly linuxDesktopEntryName: string;
  readonly linuxWmClass: string;
}

export function resolveDesktopRuntimeIdentity(input: {
  readonly isDevelopment: boolean;
  readonly appVersion: string;
}): DesktopRuntimeIdentity {
  if (input.isDevelopment) {
    return {
      updateChannel: "latest",
      baseDirName: ".t3",
      stateDirName: "userdata",
      userDataDirName: "t3code-dev",
      legacyUserDataDirName: "T3 Code (Dev)",
      appUserModelId: "com.t3tools.t3code.dev",
      linuxDesktopEntryName: "t3code-dev.desktop",
      linuxWmClass: "t3code-dev",
    };
  }

  const updateChannel = resolveDefaultDesktopUpdateChannel(input.appVersion);
  if (updateChannel === "gmacko") {
    return {
      updateChannel,
      baseDirName: ".t3-gmacko",
      stateDirName: "userdata-gmacko",
      userDataDirName: "t3code-gmacko",
      legacyUserDataDirName: "T3 Code (Gmacko)",
      appUserModelId: "com.t3tools.t3code.gmacko",
      linuxDesktopEntryName: "t3code-gmacko.desktop",
      linuxWmClass: "t3code-gmacko",
    };
  }

  return {
    updateChannel,
    baseDirName: ".t3",
    stateDirName: "userdata",
    userDataDirName: "t3code",
    legacyUserDataDirName: "T3 Code (Alpha)",
    appUserModelId: "com.t3tools.t3code",
    linuxDesktopEntryName: "t3code.desktop",
    linuxWmClass: "t3code",
  };
}
