import { DESKTOP_PREVIEW_CAPTURE_ACTIVITY } from "@t3tools/contracts";
import { flushSync } from "react-dom";

import { acquireBrowserSurfaceActivity } from "./browserSurfaceStore";

/** Lets Electron capture an inactive guest without exposing it or keeping it painting afterward. */
export function installDesktopCaptureActivity() {
  const releases = new Map<number, () => void>();
  let sequence = 0;
  const activity = {
    async acquire(serverTabId: string) {
      const webview = Array.from(document.querySelectorAll("[data-preview-server-tab]")).find(
        (element) => element.getAttribute("data-preview-server-tab") === serverTabId,
      );
      const runtimeTabId = webview?.getAttribute("data-preview-tab");
      if (!runtimeTabId) throw new Error("The browser tab is no longer attached.");
      const token = ++sequence;
      flushSync(() => releases.set(token, acquireBrowserSurfaceActivity(runtimeTabId)));
      let firstFrame = 0;
      let secondFrame = 0;
      let timeout = 0;
      try {
        await new Promise<void>((resolve, reject) => {
          timeout = window.setTimeout(
            () => reject(new Error("The browser host did not paint.")),
            3000,
          );
          firstFrame = requestAnimationFrame(() => {
            secondFrame = requestAnimationFrame(() => resolve());
          });
        });
        return token;
      } catch (cause) {
        activity.release(token);
        throw cause;
      } finally {
        clearTimeout(timeout);
        cancelAnimationFrame(firstFrame);
        cancelAnimationFrame(secondFrame);
      }
    },
    release(token: number) {
      const release = releases.get(token);
      releases.delete(token);
      release?.();
    },
  };
  Object.defineProperty(globalThis, DESKTOP_PREVIEW_CAPTURE_ACTIVITY, {
    configurable: true,
    value: activity,
  });
  return () => {
    for (const release of releases.values()) release();
    releases.clear();
    Reflect.deleteProperty(globalThis, DESKTOP_PREVIEW_CAPTURE_ACTIVITY);
  };
}
