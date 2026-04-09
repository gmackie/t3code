import type { BrowserWindow } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DesktopBridge, LocalPluginEnvelope } from "@t3tools/contracts";

const {
  exposeInMainWorldMock,
  getAllWindowsMock,
  ipcRendererOnMock,
  ipcRendererRemoveListenerMock,
  sendLiveMock,
  sendDeadMock,
} = vi.hoisted(() => {
  const exposeInMainWorldMock = vi.fn();
  const getAllWindowsMock = vi.fn();
  const ipcRendererOnMock = vi.fn();
  const ipcRendererRemoveListenerMock = vi.fn();
  const sendLiveMock = vi.fn();
  const sendDeadMock = vi.fn();

  process.env.T3CODE_DESKTOP_WS_URL = "ws://127.0.0.1:4321";

  return {
    exposeInMainWorldMock,
    getAllWindowsMock,
    ipcRendererOnMock,
    ipcRendererRemoveListenerMock,
    sendLiveMock,
    sendDeadMock,
  };
});

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: getAllWindowsMock,
  },
  contextBridge: {
    exposeInMainWorld: exposeInMainWorldMock,
  },
  ipcRenderer: {
    on: ipcRendererOnMock,
    removeListener: ipcRendererRemoveListenerMock,
  },
}));

import { createLocalPluginBridge, LOCAL_PLUGIN_EVENT_CHANNEL } from "./localPluginBridge";

const envelope = {
  type: "event",
  version: 1,
  sequence: 1,
  event: {
    id: "evt-1" as LocalPluginEnvelope["event"]["id"],
    kind: "turn.settled",
    createdAt: "2026-03-23T00:00:00.000Z",
    provider: "codex",
    threadId: "thread-1" as LocalPluginEnvelope["event"]["threadId"],
    turnId: "turn-1" as LocalPluginEnvelope["event"]["turnId"],
    result: "completed",
  },
} as LocalPluginEnvelope;

function createWindowMock(isDestroyed: boolean, sendMock: ReturnType<typeof vi.fn>): BrowserWindow {
  return {
    isDestroyed: () => isDestroyed,
    webContents: {
      send: sendMock,
    },
  } as unknown as BrowserWindow;
}

describe("createLocalPluginBridge", () => {
  beforeEach(() => {
    getAllWindowsMock.mockReset();
    sendLiveMock.mockReset();
    sendDeadMock.mockReset();
  });

  it("broadcasts published envelopes to alive windows and subscribed listeners", () => {
    const bridge = createLocalPluginBridge();
    const listener = vi.fn();
    const unsubscribe = bridge.subscribe(listener);
    const liveWindow = createWindowMock(false, sendLiveMock);
    const deadWindow = createWindowMock(true, sendDeadMock);

    getAllWindowsMock.mockReturnValue([liveWindow, deadWindow]);

    bridge.publish(envelope);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(envelope);
    expect(sendLiveMock).toHaveBeenCalledTimes(1);
    expect(sendLiveMock).toHaveBeenCalledWith(LOCAL_PLUGIN_EVENT_CHANNEL, envelope);
    expect(sendDeadMock).not.toHaveBeenCalled();

    unsubscribe();
    bridge.publish(envelope);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("ignores invalid backend messages", () => {
    const bridge = createLocalPluginBridge();
    const listener = vi.fn();
    const liveWindow = createWindowMock(false, sendLiveMock);

    getAllWindowsMock.mockReturnValue([liveWindow]);
    bridge.subscribe(listener);

    bridge.handleBackendMessage({ type: "event", version: 1, sequence: 1 });

    expect(listener).not.toHaveBeenCalled();
    expect(sendLiveMock).not.toHaveBeenCalled();
  });
});

describe("preload", () => {
  beforeEach(() => {
    exposeInMainWorldMock.mockReset();
    ipcRendererOnMock.mockReset();
    ipcRendererRemoveListenerMock.mockReset();
  });

  it("exposes onLocalPluginEvent that filters invalid payloads and unsubscribes", async () => {
    let exposedBridge: DesktopBridge | null = null;
    exposeInMainWorldMock.mockImplementation((_name: string, api: DesktopBridge) => {
      exposedBridge = api;
    });

    await import("./preload");

    expect(exposedBridge).not.toBeNull();
    const listener = vi.fn();
    const unsubscribe = exposedBridge!.onLocalPluginEvent!(listener);

    expect(ipcRendererOnMock).toHaveBeenCalledTimes(1);
    expect(ipcRendererOnMock).toHaveBeenCalledWith(
      LOCAL_PLUGIN_EVENT_CHANNEL,
      expect.any(Function),
    );

    const wrappedListener = ipcRendererOnMock.mock.calls[0]![1] as (
      event: Electron.IpcRendererEvent,
      payload: unknown,
    ) => void;

    wrappedListener({} as Electron.IpcRendererEvent, null);
    wrappedListener({} as Electron.IpcRendererEvent, "not-an-envelope");
    wrappedListener({} as Electron.IpcRendererEvent, envelope);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(envelope);

    unsubscribe();

    expect(ipcRendererRemoveListenerMock).toHaveBeenCalledTimes(1);
    expect(ipcRendererRemoveListenerMock).toHaveBeenCalledWith(
      LOCAL_PLUGIN_EVENT_CHANNEL,
      wrappedListener,
    );
  });
});
