import { randomUUID } from "node:crypto";

import type {
  BrowserAutomationRequest,
  BrowserAutomationResult,
  DesktopBrowserAutomationRequestEnvelope,
  DesktopBrowserAutomationResponseEnvelope,
} from "@t3tools/contracts";

export interface DesktopBrowserAutomationMessagePort {
  send: (message: unknown) => boolean;
  on: (event: "message", listener: (message: unknown) => void) => unknown;
  off: (event: "message", listener: (message: unknown) => void) => unknown;
}

export interface DesktopBrowserAutomationClient {
  sendRequest: (payload: BrowserAutomationRequest) => Promise<BrowserAutomationResult>;
}

interface PendingRequest {
  resolve: (result: BrowserAutomationResult) => void;
  reject: (error: Error) => void;
}

let processDesktopBrowserAutomationClient: DesktopBrowserAutomationClient | null | undefined;

function isResponseEnvelope(message: unknown): message is DesktopBrowserAutomationResponseEnvelope {
  if (typeof message !== "object" || message === null) {
    return false;
  }
  return Reflect.get(message, "kind") === "desktop-browser-automation-response";
}

export function createDesktopBrowserAutomationClient(
  port: DesktopBrowserAutomationMessagePort,
): DesktopBrowserAutomationClient {
  const pending = new Map<string, PendingRequest>();

  const handleMessage = (message: unknown): void => {
    if (!isResponseEnvelope(message)) {
      return;
    }

    const requestId = message.requestId;
    const entry = pending.get(requestId);
    if (!entry) {
      return;
    }

    pending.delete(requestId);
    if (message.ok) {
      entry.resolve(message.result);
      return;
    }

    entry.reject(new Error(message.error));
  };

  port.on("message", handleMessage);

  return {
    sendRequest: (payload) =>
      new Promise<BrowserAutomationResult>((resolve, reject) => {
        const requestId = randomUUID();
        const envelope: DesktopBrowserAutomationRequestEnvelope = {
          kind: "desktop-browser-automation-request",
          requestId,
          payload,
        };
        pending.set(requestId, { resolve, reject });

        try {
          port.send(envelope);
        } catch (error) {
          pending.delete(requestId);
          reject(
            error instanceof Error
              ? error
              : new Error(`Failed to send browser automation request: ${String(error)}`),
          );
        }
      }),
  };
}

export function createProcessDesktopBrowserAutomationClient(): DesktopBrowserAutomationClient | null {
  if (processDesktopBrowserAutomationClient !== undefined) {
    return processDesktopBrowserAutomationClient;
  }
  if (typeof process.send !== "function") {
    processDesktopBrowserAutomationClient = null;
    return processDesktopBrowserAutomationClient;
  }

  processDesktopBrowserAutomationClient = createDesktopBrowserAutomationClient(
    process as DesktopBrowserAutomationMessagePort,
  );
  return processDesktopBrowserAutomationClient;
}
