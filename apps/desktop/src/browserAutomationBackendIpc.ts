import type {
  BrowserAutomationRequest,
  BrowserAutomationResult,
  DesktopBrowserAutomationErrorEnvelope,
  DesktopBrowserAutomationRequestEnvelope,
  DesktopBrowserAutomationSuccessEnvelope,
} from "@t3tools/contracts";

export interface BrowserAutomationMessageSource {
  on(event: "message", listener: (message: unknown) => void): unknown;
  off(event: "message", listener: (message: unknown) => void): unknown;
  send(message: unknown): boolean;
}

export interface BrowserAutomationBackendBridge {
  handleRequest: (request: BrowserAutomationRequest) => Promise<BrowserAutomationResult>;
}

const listeners = new WeakMap<BrowserAutomationBackendBridge, (message: unknown) => void>();

function isRequestEnvelope(message: unknown): message is DesktopBrowserAutomationRequestEnvelope {
  if (typeof message !== "object" || message === null) {
    return false;
  }
  return Reflect.get(message, "kind") === "desktop-browser-automation-request";
}

export function attachBackendBrowserAutomationBridge(
  source: BrowserAutomationMessageSource,
  bridge: BrowserAutomationBackendBridge,
): void {
  const listener = (message: unknown) => {
    if (!isRequestEnvelope(message)) {
      return;
    }

    void bridge
      .handleRequest(message.payload)
      .then((result) => {
        const envelope: DesktopBrowserAutomationSuccessEnvelope = {
          kind: "desktop-browser-automation-response",
          requestId: message.requestId,
          ok: true,
          result,
        };
        source.send(envelope);
      })
      .catch((error) => {
        const envelope: DesktopBrowserAutomationErrorEnvelope = {
          kind: "desktop-browser-automation-response",
          requestId: message.requestId,
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : `Browser automation request failed: ${String(error)}`,
        };
        source.send(envelope);
      });
  };

  listeners.set(bridge, listener);
  source.on("message", listener);
}

export function detachBackendBrowserAutomationBridge(
  source: BrowserAutomationMessageSource,
  bridge: BrowserAutomationBackendBridge,
): void {
  const listener = listeners.get(bridge);
  if (!listener) {
    return;
  }

  source.off("message", listener);
  listeners.delete(bridge);
}
