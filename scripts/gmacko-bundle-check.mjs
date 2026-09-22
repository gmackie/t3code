import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";

// Check emitted application assets: source transpilation does not catch missing
// imports. Copy outside hidden worktrees, which oxlint otherwise skips.
const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "gmacko-bundle-check-"));
try {
  await NodeFSP.cp("apps/web/dist/assets", NodePath.join(directory, "assets"), { recursive: true });
  const config = NodePath.join(directory, "oxlint.json");
  await NodeFSP.writeFile(
    config,
    JSON.stringify({
      env: { browser: true, node: true, worker: true },
      // Guarded optional globals in React, ProseMirror and UMD dependencies.
      globals: Object.fromEntries(
        ["__DEV__", "__BUILD_DISABLE_RHC__", "__REACT_DEVTOOLS_GLOBAL_HOOK__", "define", "os"].map(
          (name) => [name, "readonly"],
        ),
      ),
      categories: { correctness: "off" },
      rules: { "no-undef": "error" },
    }),
  );
  const result = NodeChildProcess.spawnSync(
    "npx",
    ["--yes", "oxlint@1.85.0", "--config", config, NodePath.join(directory, "assets")],
    {
      cwd: directory,
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Release bundle contains undefined references");
} finally {
  await NodeFSP.rm(directory, { recursive: true, force: true });
}
