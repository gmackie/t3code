import type {
  BrowserClearThreadInput,
  BrowserEnsureTabInput,
  BrowserEvent,
  BrowserNavigateInput,
  BrowserSyncHostInput,
  BrowserTabTargetInput,
  LocalApi,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "@t3tools/contracts";

import { getPrimaryEnvironmentConnection } from "./environments/runtime";
import { readLocalApi } from "./localApi";

export interface NativeApi {
  readonly shell?: LocalApi["shell"];
  readonly browser?: {
    ensureTab: (input: BrowserEnsureTabInput) => Promise<void>;
    navigate: (input: BrowserNavigateInput) => Promise<void>;
    goBack: (input: BrowserTabTargetInput) => Promise<void>;
    goForward: (input: BrowserTabTargetInput) => Promise<void>;
    reload: (input: BrowserTabTargetInput) => Promise<void>;
    closeTab: (input: BrowserTabTargetInput) => Promise<void>;
    syncHost: (input: BrowserSyncHostInput) => Promise<void>;
    clearThread: (input: BrowserClearThreadInput) => Promise<void>;
    onEvent: (listener: (event: BrowserEvent) => void) => () => void;
  };
  readonly projects?: {
    writeFile: (input: ProjectWriteFileInput) => Promise<ProjectWriteFileResult>;
  };
}

export function readNativeApi(): NativeApi | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  const localApi = readLocalApi();
  const desktopBridge = window.desktopBridge;
  const environmentClient = getPrimaryEnvironmentConnection().client;

  return {
    ...(localApi ? { shell: localApi.shell } : {}),
    ...(desktopBridge
      ? {
          browser: {
            ensureTab: (input: BrowserEnsureTabInput) => desktopBridge.browserEnsureTab(input),
            navigate: (input: BrowserNavigateInput) => desktopBridge.browserNavigate(input),
            goBack: (input: BrowserTabTargetInput) => desktopBridge.browserGoBack(input),
            goForward: (input: BrowserTabTargetInput) => desktopBridge.browserGoForward(input),
            reload: (input: BrowserTabTargetInput) => desktopBridge.browserReload(input),
            closeTab: (input: BrowserTabTargetInput) => desktopBridge.browserCloseTab(input),
            syncHost: (input: BrowserSyncHostInput) => desktopBridge.browserSyncHost(input),
            clearThread: (input: BrowserClearThreadInput) =>
              desktopBridge.browserClearThread(input),
            onEvent: (listener: (event: BrowserEvent) => void) =>
              desktopBridge.onBrowserEvent(listener),
          },
        }
      : {}),
    projects: {
      writeFile: (input: ProjectWriteFileInput) => environmentClient.projects.writeFile(input),
    },
  };
}
