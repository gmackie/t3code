#!/usr/bin/env node
// Usage: node scripts/ci-deadline.mjs <minutes> -- <command> [args...]
// A host-mode step timeout kills only the step shell, so pnpm or xcodebuild keep
// its output open and hold the Mini. Kills the command's whole process group at
// the deadline (exit 124) and on exit. Dependency-free: it wraps `pnpm install`.

import * as NodeChildProcess from "node:child_process";
import * as NodeOS from "node:os";

const [minutesArg, separator, command, ...args] = process.argv.slice(2);
const minutes = Number(minutesArg);
if (!(minutes > 0) || separator !== "--" || !command) {
  console.error("Usage: node scripts/ci-deadline.mjs <minutes> -- <command> [args...]");
  process.exit(2);
}

const child = NodeChildProcess.spawn(command, args, { detached: true, stdio: "inherit" });

const signalGroup = (signal) => {
  try {
    process.kill(-child.pid, signal);
  } catch {
    // The group is already gone.
  }
};

let timedOut = false;
const deadline = setTimeout(() => {
  timedOut = true;
  console.error(`ci-deadline: ${command} ran past ${minutes} minutes; stopping it.`);
  signalGroup("SIGTERM");
  setTimeout(() => signalGroup("SIGKILL"), 30_000).unref();
}, minutes * 60_000);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => signalGroup(signal));
}

child.on("error", (error) => {
  console.error(`ci-deadline: could not start ${command}: ${error.message}`);
  process.exit(127);
});

child.on("exit", (code, signal) => {
  clearTimeout(deadline);
  signalGroup("SIGKILL");
  if (timedOut) process.exit(124);
  process.exit(code ?? 128 + (NodeOS.constants.signals[signal] ?? 0));
});
