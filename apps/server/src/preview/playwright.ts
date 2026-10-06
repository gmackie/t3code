// @effect-diagnostics nodeBuiltinImport:off -- Loads a disk-backed runtime dependency.
import * as NodeModule from "node:module";

// Playwright's files stay beside the package, including in standalone CLI archives.
// Node single-executables can resolve these with createRequire, but not ESM import.
const requirePlaywright = NodeModule.createRequire(import.meta.url);

export function loadChromium() {
  return (requirePlaywright("playwright-core") as typeof import("playwright-core")).chromium;
}
