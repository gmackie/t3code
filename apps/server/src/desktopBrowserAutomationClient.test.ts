import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";

import {
  createDesktopBrowserAutomationClient,
  type DesktopBrowserAutomationMessagePort,
} from "./desktopBrowserAutomationClient";

class MessagePort extends EventEmitter implements DesktopBrowserAutomationMessagePort {
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

describe("createDesktopBrowserAutomationClient", () => {
  it("sends requests and resolves matching responses", async () => {
    const port = new MessagePort();
    const client = createDesktopBrowserAutomationClient(port);

    const pending = client.sendRequest({
      type: "navigate",
      threadId: "thread-1",
      url: "https://example.com",
    });

    expect(port.sentMessages).toHaveLength(1);
    const requestEnvelope = port.sentMessages[0] as {
      requestId: string;
      payload: unknown;
    };
    expect(requestEnvelope).toMatchObject({
      kind: "desktop-browser-automation-request",
      payload: {
        type: "navigate",
        threadId: "thread-1",
        url: "https://example.com",
      },
    });

    port.emit("message", {
      kind: "desktop-browser-automation-response",
      requestId: requestEnvelope.requestId,
      ok: true,
      result: {
        message: "navigated",
        url: "https://example.com",
      },
    });

    await expect(pending).resolves.toEqual({
      message: "navigated",
      url: "https://example.com",
    });
  });
});
