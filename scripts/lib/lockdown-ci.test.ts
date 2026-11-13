// @effect-diagnostics nodeBuiltinImport:off - Tests the CI shell boundary with isolated executables.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { expect, it } from "vite-plus/test";

const buildScript = NodeURL.fileURLToPath(new URL("../build-lockdown-ci.sh", import.meta.url));

it("rejects unsupported targets before invoking build tools", () => {
  const result = NodeChildProcess.spawnSync("bash", [buildScript, "win", "x64", "/unused"], {
    encoding: "utf8",
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("Unsupported locked desktop target");
});

it("stops before packaging when the lockdown bundle audit fails", () => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "lockdown-ci-test-"));
  try {
    const bin = NodePath.join(directory, "tools");
    NodeFS.mkdirSync(bin);
    for (const name of ["server", "web", "desktop"]) {
      NodeFS.mkdirSync(NodePath.join(directory, "apps", name), { recursive: true });
    }
    NodeFS.writeFileSync(
      NodePath.join(bin, "pnpm"),
      '#!/bin/sh\nprintf "%s|%s" "$T3CODE_CLERK_PUBLISHABLE_KEY" "$T3CODE_DESKTOP_UPDATE_REPOSITORY" > "$BUILD_ENV_MARKER"\nexit 0\n',
      { mode: 0o755 },
    );
    NodeFS.writeFileSync(
      NodePath.join(bin, "node"),
      `#!/bin/sh
case "$1" in
  scripts/verify-locked-build.mjs) echo 'prohibited runtime detected' >&2; exit 42 ;;
  scripts/build-desktop-artifact.ts) touch "$PACKAGING_MARKER" ;;
esac
exit 0
`,
      { mode: 0o755 },
    );
    const marker = NodePath.join(directory, "packaged");
    const buildEnv = NodePath.join(directory, "build-env");
    const result = NodeChildProcess.spawnSync(
      "bash",
      [buildScript, "linux", "x64", NodePath.join(directory, "release")],
      {
        cwd: directory,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          PACKAGING_MARKER: marker,
          BUILD_ENV_MARKER: buildEnv,
          T3CODE_CLERK_PUBLISHABLE_KEY: "pk_live_Y2xlcmsudDMuY29kZXMk",
          T3CODE_DESKTOP_UPDATE_REPOSITORY: "gmackie/t3code",
        },
        encoding: "utf8",
      },
    );
    expect(result.status).toBe(42);
    expect(result.stderr).toContain("prohibited runtime detected");
    // Cloud keys and the update repository the runner exported never reach the build.
    expect(NodeFS.readFileSync(buildEnv, "utf8")).toBe("|");
    expect(NodeFS.existsSync(marker)).toBe(false);
  } finally {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});
