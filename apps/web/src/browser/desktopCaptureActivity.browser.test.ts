import { DESKTOP_PREVIEW_CAPTURE_ACTIVITY } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { fakeTimers, stubGlobal } from "../../test/render";
import { acquireBrowserSurfaceActivity, useBrowserSurfaceStore } from "./browserSurfaceStore";
import { installDesktopCaptureActivity } from "./desktopCaptureActivity";

const prepare = () => {
  const stack = new DisposableStack();
  document.body.innerHTML =
    '<div data-preview-server-tab="server-tab" data-preview-tab="runtime-tab"></div>';
  stack.defer(() => {
    document.body.innerHTML = "";
    useBrowserSurfaceStore.setState({ activityByTabId: {}, byTabId: {} });
  });
  const frames: FrameRequestCallback[] = [];
  stack.use(
    stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback)),
  );
  stack.use(stubGlobal("cancelAnimationFrame", vi.fn()));
  stack.defer(installDesktopCaptureActivity());
  const activity = Reflect.get(globalThis, DESKTOP_PREVIEW_CAPTURE_ACTIVITY) as {
    acquire: (tabId: string) => Promise<number>;
    release: (token: number) => void;
  };
  return { activity, frames, [Symbol.dispose]: () => stack.dispose() };
};

describe("desktop capture activity", () => {
  it("waits for painting, retains overlapping captures, and preserves recording activity", async () => {
    using setup = prepare();
    const { activity, frames } = setup;
    const recording = acquireBrowserSurfaceActivity("runtime-tab");
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
  });

  it("releases activity when the host cannot paint", async () => {
    using _timers = fakeTimers();
    using setup = prepare();
    const failed = expect(setup.activity.acquire("server-tab")).rejects.toThrow("did not paint");
    await vi.advanceTimersByTimeAsync(3000);
    await failed;
    expect(useBrowserSurfaceStore.getState().activityByTabId["runtime-tab"]).toBeUndefined();
  });
});
