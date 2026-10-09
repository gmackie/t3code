import { useAtomValue } from "@effect/atom-react";
import {
  METAMASK_BROWSER_PROFILE_ID,
  type EnvironmentId,
  type PreviewRuntime,
  type PreviewSessionSnapshot,
} from "@t3tools/contracts";

import { isElectron } from "~/env";
import { isPreviewSupportedInRuntime } from "~/previewStateStore";
import { primaryEnvironmentIdAtom } from "~/state/primaryEnvironment";
import {
  readEnvironmentSupportsServerBrowser,
  useEnvironmentSupportsServerBrowser,
} from "~/state/entities";

export function previewRuntimeFor(environmentId: EnvironmentId): PreviewRuntime | undefined {
  return readEnvironmentSupportsServerBrowser(environmentId) ? "server" : undefined;
}

/** Electron hosts its own browser tabs; other clients need the environment to host them. */
export function isPreviewAvailableFor(environmentId: EnvironmentId): boolean {
  return isPreviewSupportedInRuntime() || readEnvironmentSupportsServerBrowser(environmentId);
}

export function usePreviewAvailable(environmentId: EnvironmentId | null): boolean {
  const serverBrowser = useEnvironmentSupportsServerBrowser(environmentId);
  return isPreviewSupportedInRuntime() || serverBrowser;
}

/**
 * Whether this client draws a server tab with its own `<webview>`. The desktop
 * app renders tabs of the server it launched, which drives them over the
 * desktop browser channel; every other client and environment streams them.
 */
export function rendersServerTabNatively(
  environmentId: EnvironmentId,
  primaryEnvironmentId: EnvironmentId | null,
  snapshot: Pick<PreviewSessionSnapshot, "runtime" | "profileId"> | null | undefined,
): boolean {
  return (
    isElectron &&
    snapshot?.runtime === "server" &&
    snapshot.profileId !== METAMASK_BROWSER_PROFILE_ID &&
    primaryEnvironmentId !== null &&
    environmentId === primaryEnvironmentId
  );
}

export function useRendersServerTabNatively(
  environmentId: EnvironmentId,
  snapshot: Pick<PreviewSessionSnapshot, "runtime" | "profileId"> | null | undefined,
): boolean {
  return rendersServerTabNatively(environmentId, useAtomValue(primaryEnvironmentIdAtom), snapshot);
}
