export interface DesktopRuntimeIdentity {
  readonly appId: string;
  readonly appUserModelId: string;
  readonly displayName: string;
  readonly packageName: string;
  readonly stateDirName: string;
  readonly updaterCacheDirName: string;
  readonly userDataDirName: string;
}

export function isGmackoDesktopAppDisplayName(appDisplayName: string | undefined | null): boolean;
export function isGmackoDesktopPackageName(packageName: string | undefined | null): boolean;
export function isGmackoDesktopAppId(appId: string | undefined | null): boolean;

export function getDesktopRuntimeIdentity(input: {
  readonly isDevelopment: boolean;
  readonly appDisplayName: string | undefined | null;
  readonly packageName?: string | undefined | null;
  readonly appId?: string | undefined | null;
}): DesktopRuntimeIdentity;
