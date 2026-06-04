// @effect-diagnostics globalTimersInEffect:off
import { Effect, Layer } from "effect";

import { type RuntimeMode, ServerConfig } from "./config.ts";

const DEFAULT_DESKTOP_PARENT_WATCHDOG_INTERVAL_MS = 1_000;

export function shouldDesktopParentWatchdogStop(input: {
  readonly mode: RuntimeMode;
  readonly initialParentPid: number;
  readonly currentParentPid: number;
  readonly isInitialParentAlive: boolean;
}): boolean {
  if (input.mode !== "desktop") {
    return false;
  }

  if (!Number.isInteger(input.initialParentPid) || input.initialParentPid <= 1) {
    return false;
  }

  return input.currentParentPid !== input.initialParentPid || !input.isInitialParentAlive;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error.code === "ESRCH" || error.code === "ENOENT")
    );
  }
}

function triggerWatchdogShutdown(): void {
  process.exitCode = 0;
  process.kill(process.pid, "SIGTERM");
}

export const DesktopParentWatchdogLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const initialParentPid = process.ppid;

    if (config.mode !== "desktop" || initialParentPid <= 1) {
      return;
    }

    const timer = setInterval(() => {
      if (
        shouldDesktopParentWatchdogStop({
          mode: config.mode,
          initialParentPid,
          currentParentPid: process.ppid,
          isInitialParentAlive: isProcessAlive(initialParentPid),
        })
      ) {
        clearInterval(timer);
        triggerWatchdogShutdown();
      }
    }, DEFAULT_DESKTOP_PARENT_WATCHDOG_INTERVAL_MS);

    timer.unref();

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        clearInterval(timer);
      }),
    );
  }),
);
