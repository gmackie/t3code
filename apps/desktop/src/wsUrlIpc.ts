export const GET_WS_URL_CHANNEL = "desktop:get-ws-url";

interface SyncIpcMain {
  removeAllListeners: (channel: string) => void;
  on: (channel: string, listener: (event: { returnValue?: unknown }) => void) => void;
}

export function registerDesktopWsUrlIpcHandler(
  ipcMain: SyncIpcMain,
  getWsUrl: () => string | null,
): void {
  ipcMain.removeAllListeners(GET_WS_URL_CHANNEL);
  ipcMain.on(GET_WS_URL_CHANNEL, (event) => {
    event.returnValue = getWsUrl();
  });
}
