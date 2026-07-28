// @effect-diagnostics nodeBuiltinImport:off - This test validates repository workflow policy.
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";
import { describe, expect, it } from "vitest";

const workflowPath = NodeURL.fileURLToPath(
  new URL("../../.github/workflows/gmacko-sync-upstream.yml", import.meta.url),
);

describe("gmacko upstream sync workflow", () => {
  it("automatically rebases custom-local onto upstream and dispatches a release", () => {
    const workflow = NodeFS.readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("git rebase --force-rebase -X theirs upstream/main");
    expect(workflow).not.toContain("git merge --no-edit");
    expect(workflow).toContain(
      'git push --force-with-lease="refs/heads/custom-local:$START_SHA" origin "HEAD:custom-local"',
    );
    expect(workflow).not.toContain("git push --force origin");
    expect(workflow).not.toContain("gh pr create");
    expect(workflow).toContain('--repo "$GITHUB_REPOSITORY"');
    expect(workflow).toContain("gh workflow run release.yml");
    expect(workflow).toContain("--ref custom-local");
    expect(workflow).toContain("-f channel=gmacko");
  });
});
