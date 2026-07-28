// @effect-diagnostics nodeBuiltinImport:off - This test validates repository workflow policy.
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";
import { describe, expect, it } from "vite-plus/test";

const workflowPath = NodeURL.fileURLToPath(
  new URL("../../.github/workflows/gmacko-sync-upstream.yml", import.meta.url),
);

describe("gmacko upstream sync workflow", () => {
  it("opens a reviewable sync PR even when upstream conflicts with custom-local", () => {
    const workflow = NodeFS.readFileSync(workflowPath, "utf8");

    expect(workflow).toContain('git switch -C "$SYNC_BRANCH" upstream/main');
    expect(workflow).not.toContain("git merge --no-edit upstream/main");
    expect(workflow).not.toContain("-X theirs");
    expect(workflow).toContain('git ls-remote --exit-code --heads origin "$SYNC_BRANCH"');
    expect(workflow).not.toContain("|| true");
    expect(workflow).toContain("gh pr create");
    expect(workflow).toContain("--base custom-local");
    expect(workflow).not.toContain("gh workflow run release.yml");
  });
});
