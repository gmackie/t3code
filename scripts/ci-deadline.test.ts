// @effect-diagnostics nodeBuiltinImport:off - This test exercises a dependency-free CI wrapper script.
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";
import { describe, expect, it } from "vite-plus/test";

const scriptPath = NodeURL.fileURLToPath(new URL("./ci-deadline.mjs", import.meta.url));

// spawnSync returns only once every holder of the child's stdout has exited,
// which is exactly what keeps a host-mode CI step open. A leftover `sleep 600`
// would hit spawnSync's own timeout and leave no exit status.
const runWrapped = (minutes: string, script: string) =>
  NodeChildProcess.spawnSync(process.execPath, [scriptPath, minutes, "--", "sh", "-c", script], {
    encoding: "utf8",
    timeout: 30_000,
  });

describe("ci-deadline", () => {
  it("stops the whole process group at the deadline", () => {
    const result = runWrapped("0.01", "sleep 600 & sleep 600");

    expect(result.status).toBe(124);
    expect(result.stderr).toContain("ran past 0.01 minutes");
  });

  it("passes the exit code through and stops helpers the command left behind", () => {
    const result = runWrapped("10", "sleep 600 & exit 3");

    expect(result.status).toBe(3);
  });

  it("rejects a missing deadline", () => {
    const result = NodeChildProcess.spawnSync(process.execPath, [scriptPath, "--", "true"], {
      encoding: "utf8",
    });

    expect(result.status).toBe(2);
  });
});
