// @effect-diagnostics nodeBuiltinImport:off - This test exercises a dependency-free release bootstrap script.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { describe, expect, it } from "vite-plus/test";

const scriptPath = NodeURL.fileURLToPath(
  new URL("./bootstrap-release-package-versions.mjs", import.meta.url),
);

const releasePackageFiles = [
  "apps/server/package.json",
  "apps/desktop/package.json",
  "apps/web/package.json",
  "packages/contracts/package.json",
] as const;

describe("bootstrap-release-package-versions", () => {
  it("updates release manifests without installed workspace dependencies", () => {
    const rootDir = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "bootstrap-release-package-versions-"),
    );

    try {
      for (const relativePath of releasePackageFiles) {
        const filePath = NodePath.join(rootDir, relativePath);
        NodeFS.mkdirSync(NodePath.dirname(filePath), { recursive: true });
        NodeFS.writeFileSync(filePath, '{"name":"fixture","version":"0.0.0"}\n');
      }

      const result = NodeChildProcess.spawnSync(process.execPath, [scriptPath, "1.2.3"], {
        cwd: rootDir,
        encoding: "utf8",
      });

      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      for (const relativePath of releasePackageFiles) {
        const manifest = JSON.parse(
          NodeFS.readFileSync(NodePath.join(rootDir, relativePath), "utf8"),
        ) as { version: string };
        expect(manifest.version).toBe("1.2.3");
      }
    } finally {
      NodeFS.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
