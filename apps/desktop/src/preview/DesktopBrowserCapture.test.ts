import { describe, expect, it, vi } from "vite-plus/test";

import { withDesktopCaptureActivity } from "./DesktopBrowserCapture.ts";

const makeHost = () => ({
  isDestroyed: () => false,
  executeJavaScript: vi.fn(async (_expression: string) => 1),
});

describe("desktop browser capture", () => {
  it("waits for the hidden guest to paint before capturing and suspends it afterward", async () => {
    const painted = Promise.withResolvers<number>();
    const host = makeHost();
    host.executeJavaScript.mockImplementationOnce(() => painted.promise);
    const capture = vi.fn(async () => "image");
    const result = withDesktopCaptureActivity(host, "tab", capture);
    expect(capture).not.toHaveBeenCalled();
    painted.resolve(7);
    await expect(result).resolves.toBe("image");
    expect(capture).toHaveBeenCalledOnce();
    expect(host.executeJavaScript.mock.calls.at(-1)?.[0]).toContain("release(7)");
  });

  it("suspends the guest again when Chromium rejects the screenshot", async () => {
    const host = makeHost();
    await expect(
      withDesktopCaptureActivity(host, "tab", async () => {
        throw new Error("capture failed");
      }),
    ).rejects.toThrow("capture failed");
    expect(host.executeJavaScript.mock.calls.at(-1)?.[0]).toContain("release(1)");
  });

  it("releases a wedged capture so later tab actions can run", async () => {
    vi.useFakeTimers();
    try {
      const host = makeHost();
      const failed = expect(
        withDesktopCaptureActivity(host, "tab", () => new Promise(() => {})),
      ).rejects.toThrow("capture timed out");
      await vi.advanceTimersByTimeAsync(10000);
      await failed;
      expect(host.executeJavaScript.mock.calls.at(-1)?.[0]).toContain("release(1)");
      await expect(withDesktopCaptureActivity(host, "tab", async () => "recovered")).resolves.toBe(
        "recovered",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
