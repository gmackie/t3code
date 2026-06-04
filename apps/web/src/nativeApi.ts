import type { NativeApi } from "@t3tools/contracts";

import { createEnvironmentApi } from "./environmentApi";
import { readLocalApi } from "./localApi";
import { getPrimaryEnvironmentConnection } from "./environments/runtime";

let cachedNativeApi: NativeApi | undefined;

function createDesktopBrowserApi(): NativeApi["browser"] | undefined {
  const bridge = window.desktopBridge;
  if (
    !bridge?.browserEnsureTab ||
    !bridge.browserNavigate ||
    !bridge.browserGoBack ||
    !bridge.browserGoForward ||
    !bridge.browserReload ||
    !bridge.browserCloseTab ||
    !bridge.browserSyncHost ||
    !bridge.browserClearThread ||
    !bridge.onBrowserEvent
  ) {
    return undefined;
  }

  return {
    ensureTab: bridge.browserEnsureTab,
    navigate: bridge.browserNavigate,
    goBack: bridge.browserGoBack,
    goForward: bridge.browserGoForward,
    reload: bridge.browserReload,
    closeTab: bridge.browserCloseTab,
    syncHost: bridge.browserSyncHost,
    clearThread: bridge.browserClearThread,
    onEvent: bridge.onBrowserEvent,
  };
}

export function readNativeApi(): NativeApi | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  if (window.nativeApi) {
    return window.nativeApi;
  }

  if (cachedNativeApi) {
    return cachedNativeApi;
  }

  const localApi = readLocalApi();
  if (!localApi) {
    return undefined;
  }

  const primaryConnection = getPrimaryEnvironmentConnection();
  const environmentApi = primaryConnection ? createEnvironmentApi(primaryConnection.client) : null;
  const browserApi = createDesktopBrowserApi();
  cachedNativeApi = {
    ...localApi,
    ...(environmentApi
      ? {
          projects: environmentApi.projects,
          filesystem: environmentApi.filesystem,
          git: environmentApi.git,
          orchestration: environmentApi.orchestration,
        }
      : {}),
    ...(browserApi ? { browser: browserApi } : {}),
  };
  return cachedNativeApi;
}
