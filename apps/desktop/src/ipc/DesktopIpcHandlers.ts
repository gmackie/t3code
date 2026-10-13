import * as Effect from "effect/Effect";

import * as DesktopIpc from "./DesktopIpc.ts";
import { installNotificationBadge } from "./methods/notificationBadge.ts";
import { getClientSettings, setClientSettings } from "./methods/clientSettings.ts";
import {
  clearConnectionCatalog,
  getConnectionCatalog,
  setConnectionCatalog,
} from "./methods/connectionCatalog.ts";
import {
  getLocalEnvironmentEnabled,
  setLocalEnvironmentEnabled,
} from "./methods/localEnvironment.ts";
import { getAdvertisedEndpoints, getServerExposureState } from "./methods/serverExposure.ts";
import {
  getAppBranding,
  getLocalEnvironmentBootstraps,
  getLocalEnvironmentBearerToken,
  getSystemLocale,
  getWindowFullscreenState,
  openExternal,
  openSystemSettings,
  checkSystemPermission,
  pasteAsText,
  probeRemoteEditors,
  pickFolder,
  pickProjectFavicon,
  pickThemeFiles,
  setTheme,
  showContextMenu,
} from "./methods/window.ts";
import {
  acknowledgeSnapShot,
  checkSnapShotShortcut,
  dismissSnapShotAnimation,
  getSnapShotState,
  setupSnapShot,
  previewSnapShotConfig,
  applySnapShotConfig,
  listPendingSnapShots,
  readSnapShot,
  requestSnapShotPermissions,
  setSnapShotAnimationDestination,
  setSnapShotShortcutSuppressed,
} from "./methods/snapShot.ts";
import * as PreviewIpc from "./methods/preview.ts";
import * as AppActivationIpc from "./methods/appActivation.ts";

export const installDesktopIpcHandlers = Effect.fn("desktop.ipc.installHandlers")(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;
  yield* installNotificationBadge();
  yield* PreviewIpc.installPreviewEventForwarding();

  yield* ipc.handle(AppActivationIpc.setReady);
  yield* ipc.handle(AppActivationIpc.complete);

  yield* ipc.handleSync(getAppBranding);
  yield* ipc.handleSync(getSystemLocale);
  yield* ipc.handleSync(getWindowFullscreenState);
  yield* ipc.handleSync(getLocalEnvironmentBootstraps);
  yield* ipc.handleSync(getLocalEnvironmentEnabled);
  yield* ipc.handle(setLocalEnvironmentEnabled);
  yield* ipc.handle(getLocalEnvironmentBearerToken);

  yield* ipc.handle(getClientSettings);
  yield* ipc.handle(setClientSettings);
  yield* ipc.handle(getConnectionCatalog);
  yield* ipc.handle(getSnapShotState);
  yield* ipc.handle(setupSnapShot);
  yield* ipc.handle(previewSnapShotConfig);
  yield* ipc.handle(applySnapShotConfig);
  yield* ipc.handle(requestSnapShotPermissions);
  yield* ipc.handle(checkSnapShotShortcut);
  yield* ipc.handle(setSnapShotShortcutSuppressed);
  yield* ipc.handle(listPendingSnapShots);
  yield* ipc.handle(readSnapShot);
  yield* ipc.handle(setSnapShotAnimationDestination);
  yield* ipc.handle(dismissSnapShotAnimation);
  yield* ipc.handle(acknowledgeSnapShot);
  yield* ipc.handle(setConnectionCatalog);
  yield* ipc.handle(clearConnectionCatalog);

  yield* ipc.handle(getServerExposureState);
  yield* ipc.handle(getAdvertisedEndpoints);

  yield* ipc.handle(pickFolder);
  yield* ipc.handle(pickProjectFavicon);
  yield* ipc.handle(pickThemeFiles);
  yield* ipc.handle(setTheme);
  yield* ipc.handle(showContextMenu);
  yield* ipc.handle(openExternal);
  yield* ipc.handle(openSystemSettings);
  yield* ipc.handle(checkSystemPermission);
  yield* ipc.handle(pasteAsText);
  yield* ipc.handle(probeRemoteEditors);
  for (const previewMethod of PreviewIpc.methods) {
    yield* ipc.handle(previewMethod);
  }
});
