import { EventEmitter } from "node:events";
import type { BrowserWindow } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalPluginEnvelope } from "@t3tools/contracts";

const { getAllWindowsMock, sendLiveMock } = vi.hoisted(() => {
  const getAllWindowsMock = vi.fn();
  const sendLiveMock = vi.fn();

  return {
    getAllWindowsMock,
    sendLiveMock,
  };
});

vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: getAllWindowsMock,
  },
}));

import {
  attachBackendLocalPluginBridge,
  detachBackendLocalPluginBridge,
} from "./localPluginBackendIpc";
import { createLocalPluginBridge, LOCAL_PLUGIN_EVENT_CHANNEL } from "./localPluginBridge";

const envelope = {
  type: "event",
  version: 1,
  sequence: 1,
  event: {
    id: "evt-local-plugin-ipc" as LocalPluginEnvelope["event"]["id"],
    kind: "turn.settled",
    createdAt: "2026-03-23T00:00:00.000Z",
    provider: "codex",
    threadId: "thread-1" as LocalPluginEnvelope["event"]["threadId"],
    turnId: "turn-1" as LocalPluginEnvelope["event"]["turnId"],
    result: "completed",
  },
} as LocalPluginEnvelope;

class MessageSource extends EventEmitter {
  override on(event: "message", listener: (message: unknown) => void): this {
    return super.on(event, listener);
  }

  override off(event: "message", listener: (message: unknown) => void): this {
    return super.off(event, listener);
  }
}

function createWindowMock(sendMock: ReturnType<typeof vi.fn>): BrowserWindow {
  return {
    isDestroyed: () => false,
    webContents: {
      send: sendMock,
    },
  } as unknown as BrowserWindow;
}

describe("local plugin backend IPC", () => {
  beforeEach(() => {
    getAllWindowsMock.mockReset();
    sendLiveMock.mockReset();
  });

  it("forwards backend message events through the bridge to renderer windows", () => {
    const source = new MessageSource();
    const bridge = createLocalPluginBridge();
    const listener = vi.fn();
    const liveWindow = createWindowMock(sendLiveMock);

    getAllWindowsMock.mockReturnValue([liveWindow]);
    bridge.subscribe(listener);
    attachBackendLocalPluginBridge(source, bridge);

    source.emit("message", envelope);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(envelope);
    expect(sendLiveMock).toHaveBeenCalledTimes(1);
    expect(sendLiveMock).toHaveBeenCalledWith(LOCAL_PLUGIN_EVENT_CHANNEL, envelope);

    detachBackendLocalPluginBridge(source, bridge);
    source.emit("message", envelope);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(sendLiveMock).toHaveBeenCalledTimes(1);
  });
});
