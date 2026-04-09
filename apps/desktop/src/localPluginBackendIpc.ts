import type { LocalPluginBridge } from "./localPluginBridge";

export interface LocalPluginMessageSource {
  on(event: "message", listener: (message: unknown) => void): unknown;
  off(event: "message", listener: (message: unknown) => void): unknown;
}

export function attachBackendLocalPluginBridge(
  source: LocalPluginMessageSource,
  bridge: Pick<LocalPluginBridge, "handleBackendMessage">,
): void {
  source.on("message", bridge.handleBackendMessage);
}

export function detachBackendLocalPluginBridge(
  source: LocalPluginMessageSource,
  bridge: Pick<LocalPluginBridge, "handleBackendMessage">,
): void {
  source.off("message", bridge.handleBackendMessage);
}
