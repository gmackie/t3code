// @vitest-environment jsdom
import { DESKTOP_PREVIEW_CAPTURE_ACTIVITY } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { acquireBrowserSurfaceActivity, useBrowserSurfaceStore } from "./browserSurfaceStore";
import { installDesktopCaptureActivity } from "./desktopCaptureActivity";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = "";
  useBrowserSurfaceStore.setState({ activityByTabId: {}, byTabId: {} });
});

const prepare = () => {
  document.body.innerHTML =
    '<div data-preview-server-tab="server-tab" data-preview-tab="runtime-tab"></div>';
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  const dispose = installDesktopCaptureActivity();
  const activity = Reflect.get(globalThis, DESKTOP_PREVIEW_CAPTURE_ACTIVITY) as {
    acquire: (tabId: string) => Promise<number>;
    release: (token: number) => void;
  };
  return { activity, dispose, frames };
};

describe("desktop capture activity", () => {
  it("waits for painting, retains overlapping captures, and preserves recording activity", async () => {
    const { activity, dispose, frames } = prepare();
    const recording = acquireBrowserSurfaceActivity("runtime-tab");
    try {
      const first = activity.acquire("server-tab");
      const second = activity.acquire("server-tab");
      expect(useBrowserSurfaceStore.getState().activityByTabId["runtime-tab"]).toBe(3);
      let ready = false;
      void first.then(() => {
        ready = true;
      });
      await Promise.resolve();
      expect(ready).toBe(false);
      frames.shift()!(0);
      frames.shift()!(0);
      frames.shift()!(0);
      frames.shift()!(0);
      const firstToken = await first;
      const secondToken = await second;
      activity.release(firstToken);
      activity.release(firstToken);
      expect(useBrowserSurfaceStore.getState().activityByTabId["runtime-tab"]).toBe(2);
      activity.release(secondToken);
      expect(useBrowserSurfaceStore.getState().activityByTabId["runtime-tab"]).toBe(1);
      recording();
      expect(useBrowserSurfaceStore.getState().activityByTabId["runtime-tab"]).toBeUndefined();
    } finally {
      dispose();
    }
  });

  it("releases activity when the host cannot paint", async () => {
    vi.useFakeTimers();
    const { activity, dispose } = prepare();
    try {
      const failed = expect(activity.acquire("server-tab")).rejects.toThrow("did not paint");
      await vi.advanceTimersByTimeAsync(3000);
      await failed;
      expect(useBrowserSurfaceStore.getState().activityByTabId["runtime-tab"]).toBeUndefined();
    } finally {
      dispose();
    }
  });
});
