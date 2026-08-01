// @effect-diagnostics nodeBuiltinImport:off - This test validates repository workflow policy.
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";
import { describe, expect, it } from "vite-plus/test";

const workflowPath = NodeURL.fileURLToPath(
  new URL("../../.github/workflows/gmacko-sync-upstream.yml", import.meta.url),
);

describe("gmacko upstream sync workflow", () => {
  it("automatically rebases custom-local onto upstream and dispatches a release", () => {
    const workflow = NodeFS.readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("git rebase --force-rebase -X theirs upstream/main");
    expect(workflow).not.toContain("git merge --no-edit");
    expect(workflow).toContain("vp install --lockfile-only --no-frozen-lockfile");
    expect(workflow).toContain(
      'LOCK_COMMIT_SUBJECT="chore: refresh lockfile after upstream rebase"',
    );
    expect(workflow).toContain("git commit --amend --no-edit");
    expect(workflow).toContain(
      'git push --force-with-lease="refs/heads/custom-local:$START_SHA" origin "HEAD:custom-local"',
    );
    expect(workflow).not.toContain("git push --force origin");
    expect(workflow).not.toContain("gh pr create");
    expect(workflow).toContain('--repo "$GITHUB_REPOSITORY"');
    expect(workflow).toContain("gh workflow run release.yml");
    expect(workflow).toContain("--ref custom-local");
    expect(workflow).toContain("-f channel=gmacko");
    expect(workflow).toContain('--commit "$EXPECTED_SHA"');
    expect(workflow).toContain('retry_gh_read run view "$release_run_id"');
    expect(workflow).toContain('[[ "$release_conclusion" == "success" ]]');
  });

  it("retries publication when the current custom-local SHA has no release", () => {
    const workflow = NodeFS.readFileSync(workflowPath, "utf8");
    const publishStep = workflow.slice(
      workflow.indexOf("- name: Publish synchronized GMACKO release"),
    );

    expect(publishStep).toMatch(/^- name: Publish synchronized GMACKO release\n\s+env:/m);
    expect(publishStep).toContain("repos/$GITHUB_REPOSITORY/releases?per_page=100");
    expect(publishStep).toContain("select(.target_commitish == $expected_sha)");
    expect(publishStep).toContain("select(.draft == false and .prerelease == true)");
    expect(publishStep).toContain("Release already published for $EXPECTED_SHA");
    expect(publishStep).toContain('known_release_run_ids="$(');
    expect(publishStep).toContain('--arg known "$known_release_run_ids"');
    expect(publishStep).toContain('if ! release_candidates="$(');
    expect(publishStep).toContain("Unable to list release runs; retrying.");
    expect(publishStep).toContain('if ! release_state="$(');
    expect(publishStep).toContain("Unable to read release run $release_run_id; retrying.");
  });
});
