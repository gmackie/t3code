import type { DesktopUpdateState } from "@t3tools/contracts";

interface DesktopGitHubUpdateConfig {
  provider?: string | undefined;
  owner?: string | undefined;
  repo?: string | undefined;
}

function isGmackieDesktopUpdateFeed(appUpdateConfig: DesktopGitHubUpdateConfig | null): boolean {
  return (
    appUpdateConfig?.provider === "github" &&
    appUpdateConfig.owner?.toLowerCase() === "gmackie" &&
    appUpdateConfig.repo?.toLowerCase() === "t3code"
  );
}

export function shouldBroadcastDownloadProgress(
  currentState: DesktopUpdateState,
  nextPercent: number,
): boolean {
  if (currentState.status !== "downloading") {
    return true;
  }

  const currentPercent = currentState.downloadPercent;
  if (currentPercent === null) {
    return true;
  }

  const previousStep = Math.floor(currentPercent / 10);
  const nextStep = Math.floor(nextPercent / 10);
  return nextStep !== previousStep || nextPercent === 100;
}

export function nextStatusAfterDownloadFailure(
  currentState: DesktopUpdateState,
): DesktopUpdateState["status"] {
  return currentState.availableVersion ? "available" : "error";
}

export function getCanRetryAfterDownloadFailure(currentState: DesktopUpdateState): boolean {
  return currentState.availableVersion !== null;
}

export function shouldAllowPrereleaseUpdates(args: {
  isDevelopment: boolean;
  appUpdateConfig: DesktopGitHubUpdateConfig | null;
}): boolean {
  if (args.isDevelopment) {
    return false;
  }

  return isGmackieDesktopUpdateFeed(args.appUpdateConfig);
}

export function resolveDesktopUpdateChannel(args: {
  isDevelopment: boolean;
  appUpdateConfig: DesktopGitHubUpdateConfig | null;
}): string {
  if (args.isDevelopment) {
    return "latest";
  }

  return isGmackieDesktopUpdateFeed(args.appUpdateConfig) ? "gmacko" : "latest";
}

export function getAutoUpdateDisabledReason(args: {
  isDevelopment: boolean;
  isPackaged: boolean;
  platform: NodeJS.Platform;
  appImage?: string | undefined;
  disabledByEnv: boolean;
}): string | null {
  if (args.isDevelopment || !args.isPackaged) {
    return "Automatic updates are only available in packaged production builds.";
  }
  if (args.disabledByEnv) {
    return "Automatic updates are disabled by the T3CODE_DISABLE_AUTO_UPDATE setting.";
  }
  if (args.platform === "linux" && !args.appImage) {
    return "Automatic updates on Linux require running the AppImage build.";
  }
  return null;
}
