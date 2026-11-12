// @effect-diagnostics nodeBuiltinImport:off - Exercises the release checker against emitted assets.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { buildSync } from "esbuild";
import { expect, it } from "vite-plus/test";

const checker = NodeURL.fileURLToPath(new URL("./gmacko-bundle-check.mjs", import.meta.url));
const worklet = NodeURL.fileURLToPath(
  new URL("../apps/web/src/speech/pcmWorklet.ts", import.meta.url),
);

function checkWorklet(filename: string, suffix = "") {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-bundle-test-"));
  try {
    const assets = NodePath.join(directory, "apps/web/dist/assets");
    NodeFS.mkdirSync(assets, { recursive: true });
    const output = NodePath.join(assets, filename);
    buildSync({
      entryPoints: [worklet],
      outfile: output,
      bundle: true,
      minify: true,
      format: "iife",
    });
    NodeFS.appendFileSync(output, suffix);
    return NodeChildProcess.spawnSync(process.execPath, [checker], {
      cwd: directory,
      encoding: "utf8",
      env: { ...process.env, GITHUB_ACTIONS: "true" },
    });
  } finally {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
}

it("accepts the emitted PCM capture worklet in its native runtime", () => {
  const result = checkWorklet("pcmWorklet-fixture.js");
  expect(result.status, result.stdout + result.stderr).toBe(0);
});

it("still rejects a missing application import inside the worklet", () => {
  const result = checkWorklet("pcmWorklet-fixture.js", "\nmissingWorkletImport();\n");
  expect(result.status).not.toBe(0);
  expect(result.stdout + result.stderr).toContain("missingWorkletImport");
});

it("does not allow AudioWorklet globals in ordinary application chunks", () => {
  const result = checkWorklet("application-fixture.js");
  expect(result.status).not.toBe(0);
  expect(result.stdout + result.stderr).toContain("AudioWorkletProcessor");
});
