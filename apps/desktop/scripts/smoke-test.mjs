import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { desktopDir, resolveElectronPath } from "./electron-launcher.mjs";

const mainJs = resolve(desktopDir, "dist-electron/main.js");
const childEnv = { ...process.env };
delete childEnv.ELECTRON_RUN_AS_NODE;

console.log("\nLaunching Electron smoke test...");

const child = spawn(resolveElectronPath(), [mainJs], {
  stdio: ["pipe", "pipe", "pipe"],
  cwd: desktopDir,
  env: {
    ...childEnv,
    VITE_DEV_SERVER_URL: "",
    ELECTRON_ENABLE_LOGGING: "1",
  },
});

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

const timeout = setTimeout(() => {
  child.kill();
}, 8_000);

child.on("error", (error) => {
  clearTimeout(timeout);
  console.error("\nDesktop smoke test failed to launch:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

child.on("exit", () => {
  clearTimeout(timeout);

  const fatalPatterns = [
    "Cannot find module",
    "MODULE_NOT_FOUND",
    "Refused to execute",
    "Uncaught Error",
    "Uncaught TypeError",
    "Uncaught ReferenceError",
  ];
  const failures = fatalPatterns.filter((pattern) => output.includes(pattern));

  if (failures.length > 0) {
    console.error("\nDesktop smoke test failed:");
    for (const failure of failures) {
      console.error(` - ${failure}`);
    }
    console.error("\nFull output:\n" + output);
    process.exit(1);
  }

  console.log("Desktop smoke test passed.");
  process.exit(0);
});
