// @effect-diagnostics nodeBuiltinImport:off - This test validates repository workflow policy.
import * as NodeFS from "node:fs";
import * as NodeURL from "node:url";
import { describe, expect, it } from "vite-plus/test";

const workflowPath = NodeURL.fileURLToPath(
  new URL("../../.forgejo/workflows/gmacko-nightly.yml", import.meta.url),
);

describe("ForgeGraph GMACKO release workflow", () => {
  it("cuts a release for every custom-local push", () => {
    const workflow = NodeFS.readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("push:\n    branches:\n      - custom-local");
    expect(workflow).toContain('if [[ "${GITHUB_EVENT_NAME}" == "push" ]]');
    expect(workflow).toContain('git clone --branch custom-local "$forgejo_url" lane');
    expect(workflow).toContain(
      'START_SHA="$(git ls-remote "$github_url" refs/heads/custom-local | cut -f1)"',
    );
    expect(workflow).toContain(
      "if: steps.rebase_upstream.outputs.has_changes == 'true' && github.event_name != 'push'",
    );
    expect(workflow).toContain(
      'if [[ "${GITHUB_EVENT_NAME}" != "push" && "$HAS_CHANGES" == "true" ]]',
    );
  });

  it("keeps GitHub promotion lease-protected", () => {
    const workflow = NodeFS.readFileSync(workflowPath, "utf8");

    expect(workflow).toContain(
      'git push --force-with-lease="refs/heads/custom-local:${START_SHA}" origin "${HEAD_SHA}:refs/heads/custom-local"',
    );
    expect(workflow).not.toContain('git push --force origin "${HEAD_SHA}:refs/heads/custom-local"');
  });
});
