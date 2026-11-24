// @effect-diagnostics nodeBuiltinImport:off - This test validates repository workflow policy.
import * as NodeFS from "node:fs";
import * as NodeChildProcess from "node:child_process";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { describe, expect, it } from "vite-plus/test";

const workflowPath = NodeURL.fileURLToPath(
  new URL("../../.forgejo/workflows/gmacko-nightly.yml", import.meta.url),
);

describe("ForgeGraph GMACKO release workflow", () => {
  it("carries Debian packages through collection and publication and rejects their absence", () => {
    const workflow = NodeFS.readFileSync(workflowPath, "utf8");
    const runStep = (name: string) => {
      const step = workflow.slice(workflow.indexOf(`      - name: ${name}\n`));
      const body = step.match(/        run: \|\n((?:          .*\n|\n)+)/)?.[1];
      if (!body) throw new Error(`Missing run step: ${name}`);
      return body
        .replace(/^ {10}/gm, "")
        .replaceAll("${{ matrix.platform }}", "linux")
        .replaceAll("${{ matrix.arch }}", "x64");
    };
    const scratch = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "gmacko-release-assets-"));
    try {
      NodeFS.mkdirSync(NodePath.join(scratch, "release"));
      for (const name of [
        "t3.AppImage",
        "t3.deb",
        "t3.dmg",
        "t3.zip",
        "t3.blockmap",
        "gmacko-linux.yml",
      ]) {
        NodeFS.writeFileSync(NodePath.join(scratch, "release", name), name);
      }
      NodeChildProcess.execFileSync("bash", ["-c", runStep("Collect release assets")], {
        cwd: scratch,
      });
      expect(NodeFS.readFileSync(NodePath.join(scratch, "release-publish/t3.deb"), "utf8")).toBe(
        "t3.deb",
      );
      NodeFS.renameSync(
        NodePath.join(scratch, "release-publish"),
        NodePath.join(scratch, "release-assets"),
      );
      NodeFS.writeFileSync(NodePath.join(scratch, "release-assets/SHA256SUMS"), "checksums");
      const publish = 'gh() { printf "%s\\n" "$@" > "$ARGUMENTS"; }\n' + runStep("Publish release");
      const options = {
        cwd: scratch,
        env: {
          ...process.env,
          ARGUMENTS: NodePath.join(scratch, "arguments"),
          TAG: "test",
          TARGET: "test",
          GITHUB_FORK: "test/test",
          RELEASE_NAME: "test",
        },
        encoding: "utf8" as const,
      };
      expect(NodeChildProcess.spawnSync("bash", ["-c", publish], options).status).toBe(0);
      expect(
        NodeFS.readFileSync(NodePath.join(scratch, "arguments"), "utf8").split("\n"),
      ).toContain("release-assets/t3.deb");
      NodeFS.unlinkSync(NodePath.join(scratch, "release-assets/t3.deb"));
      const missing = NodeChildProcess.spawnSync("bash", ["-c", publish], options);
      expect(missing.status).not.toBe(0);
      expect(missing.stderr).toContain("Missing expected release asset pattern: *.deb");
    } finally {
      NodeFS.rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("pins the Node runtime used by every release job", () => {
    const workflow = NodeFS.readFileSync(workflowPath, "utf8");

    expect(workflow.match(/node-version: 24\.14\.0/g) ?? []).toHaveLength(1);
    expect(workflow.match(/node-version-file: package\.json/g) ?? []).toHaveLength(7);
    expect(workflow).not.toContain("node-version: 24\n");
    const corepackSetups =
      workflow.match(/if ! command -v corepack[^]*?fi\n\s+corepack enable/g) ?? [];
    expect(corepackSetups).toHaveLength(7);
    for (const setup of corepackSetups) {
      expect(setup).toContain("npm install --global corepack@0.34.6");
    }
  });

  it("uploads iOS to TestFlight without gating the desktop release", () => {
    const workflow = NodeFS.readFileSync(workflowPath, "utf8");
    const release = workflow.slice(workflow.indexOf("  release:\n"));
    const ios = workflow.slice(
      workflow.indexOf("  ios_testflight:\n"),
      workflow.indexOf("  release:\n"),
    );

    expect(workflow).toContain("scripts/gmacko-ios-testflight.sh");
    expect(release.slice(0, release.indexOf("steps:"))).not.toContain("ios_testflight");
    expect(ios).toContain(
      "needs: [superseded, sync, preflight, relay_public_config, build_macos_x64]",
    );
    for (const [name, output] of [
      ["T3CODE_CLERK_PUBLISHABLE_KEY", "clerk_publishable_key"],
      ["T3CODE_CLERK_JWT_TEMPLATE", "clerk_jwt_template"],
      ["T3CODE_RELAY_URL", "relay_url"],
    ]) {
      expect(ios).toContain(`${name}: \u0024{{ needs.relay_public_config.outputs.${output} }}`);
    }
  });

  it("cuts a release for every custom-local push", () => {
    const workflow = NodeFS.readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("push:\n    branches:\n      - custom-local");
    expect(workflow).toContain('if [[ "${GITHUB_EVENT_NAME}" == "push" ]]');
    expect(workflow).toContain(
      'git clone --reference "$LANE_CACHE" --branch custom-local --tags "$FORGEJO_REPO_URL" lane',
    );
    expect(workflow).toContain(
      'START_SHA="$(git ls-remote "$github_url" refs/heads/custom-local | cut -f1)"',
    );
    expect(workflow).toContain(
      "if: steps.sync_upstream.outputs.has_changes == 'true' && github.event_name != 'push'",
    );
    expect(workflow).toContain("group: gmacko-nightly\n      cancel-in-progress: true");
    expect(workflow).not.toMatch(/^concurrency:/m);
  });

  it("skips every job of a push run whose commit is no longer the custom-local head", () => {
    const workflow = NodeFS.readFileSync(workflowPath, "utf8");
    const gate = "needs.superseded.outputs.current == 'true'";
    const jobsSection = workflow.slice(workflow.indexOf("\njobs:\n"));
    const jobs = jobsSection
      .split(/\n(?=  [a-z0-9_]+:\n)/)
      .slice(1)
      .map((block) => ({ name: block.slice(2, block.indexOf(":")), block }));
    const superseded = jobs.find((job) => job.name === "superseded")?.block ?? "";

    expect(superseded).toContain("runs-on: light");
    expect(superseded).toContain('if [ "${{ github.event_name }}" = "push" ]; then');
    expect(superseded).toContain("/branches/custom-local");
    expect(superseded).toContain('[ "${head}" != "${{ github.sha }}" ]');
    expect(superseded).not.toContain("needs:");
    expect(workflow).not.toMatch(/^concurrency:/m);

    const sync = jobs.find((job) => job.name === "sync")?.block ?? "";
    expect(sync).toContain("needs: superseded\n    if: " + "$" + "{{ " + gate + " }}");
    for (const { name, block } of jobs) {
      if (name === "superseded") continue;
      const condition = block.match(/^ {4}if: (.*)$/m)?.[1] ?? "";
      expect(block, name).toMatch(/^ {4}needs: /m);
      if (/always\(\)|cancelled\(\)|failure\(\)/.test(condition)) {
        expect(condition, name).toContain(gate);
      }
    }
  });

  it("releases from the scheduled run instead of waiting for a follow-up push", () => {
    const workflow = NodeFS.readFileSync(workflowPath, "utf8");
    const decide = workflow.slice(
      workflow.indexOf("  - id: decide\n"),
      workflow.indexOf("  preflight:\n"),
    );

    expect(decide).not.toContain('GITHUB_EVENT_NAME}" == "schedule"');
    expect(decide).toContain('echo "should_release=true" >> "$GITHUB_OUTPUT"');
    expect(workflow).toContain(
      "a push\n# authenticated with the Actions token does not start a follow-up run.",
    );
  });

  it("retries the current ForgeGraph lane on manual dispatch", () => {
    const workflow = NodeFS.readFileSync(workflowPath, "utf8");

    expect(workflow).toContain(
      'git clone --reference "$LANE_CACHE" --branch custom-local --tags "$FORGEJO_REPO_URL" lane',
    );
    expect(workflow).not.toContain(
      'if [[ "${GITHUB_EVENT_NAME}" == "schedule" && "$HAS_CHANGES" == "true" ]]',
    );
    expect(workflow).not.toContain(
      'if [[ "${GITHUB_EVENT_NAME}" != "push" && "$HAS_CHANGES" == "true" ]]',
    );
  });

  it("retains the current preflight checks and native prerequisites", () => {
    const workflow = NodeFS.readFileSync(workflowPath, "utf8");
    const preflightJob = workflow.slice(
      workflow.indexOf("  preflight:\n"),
      workflow.indexOf("  promote:\n"),
    );

    expect(preflightJob).toContain("node scripts/gmacko-bundle-check.mjs");
    expect(preflightJob).toContain("rm -rf /var/lib/apt/lists/*");
    const linuxPackaging = workflow.slice(
      workflow.indexOf("      - name: Install Linux packaging dependencies"),
      workflow.indexOf("      - name: Install Linux packaging dependencies") + 1300,
    );
    for (const dependency of ["libgtk-3-0t64", "libnspr4", "libnss3", "libasound2t64", "libgbm1"]) {
      expect(linuxPackaging).toContain(dependency);
    }
  });

  it("keeps GitHub promotion lease-protected", () => {
    const workflow = NodeFS.readFileSync(workflowPath, "utf8");

    expect(workflow).toContain(
      'git push --force-with-lease="refs/heads/custom-local:${START_SHA}" origin "${HEAD_SHA}:refs/heads/custom-local"',
    );
    expect(workflow).not.toContain('git push --force origin "${HEAD_SHA}:refs/heads/custom-local"');
  });

  it("pins macOS desktop builds to gmacko-mini instead of the shared macos label", () => {
    const workflow = NodeFS.readFileSync(workflowPath, "utf8");

    expect(workflow).toContain("runner: gmacko-mini");
    expect(workflow).toContain("runs-on: gmacko-mini");
    expect(workflow).not.toContain("runner: macos");
    expect(workflow).not.toMatch(/^    runs-on: macos$/m);
  });

  it("aligns release package versions before installing macOS build dependencies", () => {
    const workflow = NodeFS.readFileSync(workflowPath, "utf8");
    const buildJob = workflow.slice(
      workflow.indexOf("  build:\n"),
      workflow.indexOf("  build_macos_x64:\n"),
    );
    const x64Job = workflow.slice(
      workflow.indexOf("  build_macos_x64:\n"),
      workflow.indexOf("  release:\n"),
    );

    for (const job of [buildJob, x64Job]) {
      expect(job.indexOf("Align package versions to release version")).toBeGreaterThan(-1);
      expect(job).toContain(
        'node scripts/bootstrap-release-package-versions.mjs "${{ needs.sync.outputs.version }}"',
      );
      expect(job.indexOf("Align package versions to release version")).toBeLessThan(
        job.indexOf("Setup pnpm and install"),
      );
    }
  });

  it("serializes desktop artifact uploads on constrained runner links", () => {
    const workflow = NodeFS.readFileSync(workflowPath, "utf8");
    const desktopUploadSteps = workflow.split("      - name: Upload build artifacts\n").slice(1);

    expect(desktopUploadSteps).toHaveLength(2);
    for (const step of desktopUploadSteps) {
      expect(step).toContain("uses: https://code.forgejo.org/forgejo/upload-artifact@v5");
      expect(step).toContain("ACTIONS_ARTIFACT_UPLOAD_CONCURRENCY: 1");
      expect(step).toContain("ACTIONS_ARTIFACT_UPLOAD_TIMEOUT_MS: 1800000");
    }
  });

  it("gives release preparation enough time and memory", () => {
    const workflow = NodeFS.readFileSync(workflowPath, "utf8");
    const releaseJob = workflow.slice(workflow.indexOf("  release:\n"));

    expect(releaseJob).toContain("timeout-minutes: 60");
    expect(workflow).toContain('NODE_OPTIONS: "--max-old-space-size=4096"');
  });
});
