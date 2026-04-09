import { BrowserWindow } from "electron";
import { Schema } from "effect";
import type { LocalPluginEnvelope } from "@t3tools/contracts";
import { LocalPluginEnvelope as LocalPluginEnvelopeSchema } from "@t3tools/contracts";

export const LOCAL_PLUGIN_EVENT_CHANNEL = "desktop:local-plugin-event";

export interface LocalPluginBridge {
  readonly publish: (event: LocalPluginEnvelope) => void;
  readonly subscribe: (listener: (event: LocalPluginEnvelope) => void) => () => void;
  readonly handleBackendMessage: (message: unknown) => void;
  readonly destroy: () => void;
}

function isAliveWindow(window: BrowserWindow): boolean {
  return !window.isDestroyed();
}

const decodeLocalPluginEnvelope = Schema.decodeUnknownSync(LocalPluginEnvelopeSchema);

function broadcastLocalPluginEnvelope(event: LocalPluginEnvelope): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!isAliveWindow(window)) continue;
    window.webContents.send(LOCAL_PLUGIN_EVENT_CHANNEL, event);
  }
}

export function createLocalPluginBridge(): LocalPluginBridge {
  const listeners = new Set<(event: LocalPluginEnvelope) => void>();
  let isDestroyed = false;

  function notifyListeners(event: LocalPluginEnvelope): void {
    if (isDestroyed) return;

    for (const listener of listeners) {
      listener(event);
    }
    broadcastLocalPluginEnvelope(event);
  }

  return {
    publish: notifyListeners,
    subscribe: (listener) => {
      if (isDestroyed) {
        return () => undefined;
      }

      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    handleBackendMessage: (message) => {
      if (isDestroyed) return;

      try {
        notifyListeners(decodeLocalPluginEnvelope(message));
      } catch {
        return;
      }
    },
    destroy: () => {
      isDestroyed = true;
      listeners.clear();
    },
  };
}
