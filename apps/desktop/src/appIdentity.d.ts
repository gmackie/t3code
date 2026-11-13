export interface DesktopRuntimeIdentity {
  readonly appId: string;
  readonly appUserModelId: string;
  readonly baseDirName: string;
  readonly displayName: string;
  readonly packageName: string;
  readonly stateDirName: string;
  readonly updaterCacheDirName: string;
  readonly userDataDirName: string;
}

export function getDesktopRuntimeIdentity(input: {
  readonly isDevelopment: boolean;
  readonly appDisplayName: string | undefined | null;
  readonly packageName?: string | undefined | null;
  readonly appId?: string | undefined | null;
}): DesktopRuntimeIdentity;
