import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import {
  attachBackendBrowserAutomationBridge,
  detachBackendBrowserAutomationBridge,
} from "./browserAutomationBackendIpc";

class BackendProcessSource extends EventEmitter {
  sentMessages: unknown[] = [];

  send(message: unknown): boolean {
    this.sentMessages.push(message);
    return true;
  }

  override on(event: "message", listener: (message: unknown) => void): this {
    return super.on(event, listener);
  }

  override off(event: "message", listener: (message: unknown) => void): this {
    return super.off(event, listener);
  }
}

describe("browser automation backend IPC", () => {
  it("routes browser automation requests to the handler and sends a response", async () => {
    const source = new BackendProcessSource();
    const handleRequest = vi.fn().mockResolvedValue({
      message: "clicked #submit",
    });
    const bridge = {
      handleRequest,
    };

    attachBackendBrowserAutomationBridge(source, bridge);

    source.emit("message", {
      kind: "desktop-browser-automation-request",
      requestId: "req-1",
      payload: {
        type: "click",
        threadId: "thread-1",
        selector: "#submit",
      },
    });

    await vi.waitFor(() => {
      expect(handleRequest).toHaveBeenCalledWith({
        type: "click",
        threadId: "thread-1",
        selector: "#submit",
      });
      expect(source.sentMessages).toEqual([
        {
          kind: "desktop-browser-automation-response",
          requestId: "req-1",
          ok: true,
          result: {
            message: "clicked #submit",
          },
        },
      ]);
    });

    detachBackendBrowserAutomationBridge(source, bridge);
  });
});
