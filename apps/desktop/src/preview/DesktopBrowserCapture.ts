// @effect-diagnostics globalTimers:off - CDP relay callbacks run outside the Effect runtime.
import { DESKTOP_PREVIEW_CAPTURE_ACTIVITY } from "@t3tools/contracts";

/** Captures a desktop guest only while its renderer keeps it compositing behind the app. */
export async function withDesktopCaptureActivity<A>(
  host: Pick<Electron.WebContents, "isDestroyed" | "executeJavaScript"> | null,
  tabId: string,
  capture: () => Promise<A>,
) {
  if (!host || host.isDestroyed()) throw new Error("The browser host is closed.");
  const activity = `globalThis[${JSON.stringify(DESKTOP_PREVIEW_CAPTURE_ACTIVITY)}]`;
  const token: unknown = await host.executeJavaScript(
    `${activity}?.acquire(${JSON.stringify(tabId)})`,
  );
  if (typeof token !== "number") throw new Error("The browser host cannot prepare capture.");
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      capture(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Browser screenshot capture timed out.")),
          10000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
    if (!host.isDestroyed()) {
      await host.executeJavaScript(`${activity}?.release(${token})`).catch(() => {});
    }
  }
}
