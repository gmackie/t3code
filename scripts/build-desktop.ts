#!/usr/bin/env node

import { spawnSync } from "node:child_process";

import { getDesktopAppDisplayName } from "../apps/desktop/src/appBranding.js";
import { resolveDesktopAppDisplayName } from "./lib/desktopAppIdentity.ts";

const displayName = resolveDesktopAppDisplayName({
  cwd: process.cwd(),
  baseDisplayName: getDesktopAppDisplayName({
    isDevelopment: false,
    platform: process.platform,
  }),
});

const result = spawnSync(
  process.platform === "win32" ? "turbo.cmd" : "turbo",
  ["run", "build", "--filter=@t3tools/desktop", "--filter=t3"],
  {
    cwd: process.cwd(),
    stdio: "inherit",
    env: {
      ...process.env,
      T3CODE_DESKTOP_APP_DISPLAY_NAME: displayName,
    },
  },
);

if (result.signal) {
  process.kill(process.pid, result.signal);
}

process.exit(result.status ?? 1);
