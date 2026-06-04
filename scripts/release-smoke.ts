import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const workspaceFiles = [
  "package.json",
  "bun.lock",
  "apps/server/package.json",
  "apps/desktop/package.json",
  "apps/web/package.json",
  "apps/marketing/package.json",
  "packages/client-runtime/package.json",
  "packages/contracts/package.json",
  "packages/shared/package.json",
  "scripts/package.json",
] as const;

function copyWorkspaceManifestFixture(targetRoot: string): void {
  for (const relativePath of workspaceFiles) {
    const sourcePath = resolve(repoRoot, relativePath);
    const destinationPath = resolve(targetRoot, relativePath);
    mkdirSync(dirname(destinationPath), { recursive: true });
    cpSync(sourcePath, destinationPath);
  }
}

function writeMacManifestFixtures(targetRoot: string): { arm64Path: string; x64Path: string } {
  const assetDirectory = resolve(targetRoot, "release-assets");
  mkdirSync(assetDirectory, { recursive: true });

  const arm64Path = resolve(assetDirectory, "latest-mac.yml");
  const x64Path = resolve(assetDirectory, "latest-mac-x64.yml");

  writeFileSync(
    arm64Path,
    `version: 9.9.9-smoke.0
files:
  - url: T3-Code-9.9.9-smoke.0-arm64.zip
    sha512: arm64zip
    size: 125621344
  - url: T3-Code-9.9.9-smoke.0-arm64.dmg
    sha512: arm64dmg
    size: 131754935
path: T3-Code-9.9.9-smoke.0-arm64.zip
sha512: arm64zip
releaseDate: '2026-03-08T10:32:14.587Z'
`,
  );

  writeFileSync(
    x64Path,
    `version: 9.9.9-smoke.0
files:
  - url: T3-Code-9.9.9-smoke.0-x64.zip
    sha512: x64zip
    size: 132000112
  - url: T3-Code-9.9.9-smoke.0-x64.dmg
    sha512: x64dmg
    size: 138148807
path: T3-Code-9.9.9-smoke.0-x64.zip
sha512: x64zip
releaseDate: '2026-03-08T10:36:07.540Z'
`,
  );

  return { arm64Path, x64Path };
}

function assertContains(haystack: string, needle: string, message: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(message);
  }
}

const tempRoot = mkdtempSync(join(tmpdir(), "t3-release-smoke-"));

try {
  const workflow = readFileSync(resolve(repoRoot, ".github/workflows/release.yml"), "utf8");
  const gmackoSyncWorkflowPath = resolve(repoRoot, ".github/workflows/gmacko-sync-upstream.yml");
  const gmackoSyncWorkflow = readFileSync(gmackoSyncWorkflowPath, "utf8");
  assertContains(workflow, "- gmacko", "Release workflow is missing the gmacko channel option.");
  assertContains(
    workflow,
    "github.event_name != 'schedule' || github.repository == 'pingdotgg/t3code'",
    "Release workflow does not keep scheduled nightly releases scoped to the upstream repository.",
  );
  assertContains(
    workflow,
    "workflow_dispatch gmacko releases must run from custom-local.",
    "Release workflow does not enforce custom-local for manual gmacko releases.",
  );
  assertContains(
    workflow,
    "workflow_dispatch gmacko releases must run in gmackie/t3code.",
    "Release workflow does not enforce the gmackie/t3code fork for manual gmacko releases.",
  );
  assertContains(
    workflow,
    "needs.preflight.outputs.release_channel != 'gmacko'",
    "Release workflow does not skip CLI publishing for gmacko releases.",
  );
  assertContains(
    workflow,
    "needs.publish_cli.result == 'skipped'",
    "Release workflow does not allow GitHub release publishing after gmacko skips CLI publishing.",
  );
  assertContains(
    gmackoSyncWorkflow,
    "github.repository == 'gmackie/t3code'",
    "Gmacko sync workflow does not stay scoped to the gmackie/t3code fork.",
  );
  assertContains(
    gmackoSyncWorkflow,
    "git fetch upstream main",
    "Gmacko sync workflow does not fetch upstream main.",
  );
  assertContains(
    gmackoSyncWorkflow,
    "git merge --no-edit upstream/main",
    "Gmacko sync workflow does not merge upstream main into custom-local.",
  );
  assertContains(
    gmackoSyncWorkflow,
    "git push origin HEAD:custom-local",
    "Gmacko sync workflow does not push the merged custom-local branch.",
  );
  assertContains(
    gmackoSyncWorkflow,
    "gh workflow run release.yml --ref custom-local -f channel=gmacko",
    "Gmacko sync workflow does not dispatch the gmacko release workflow.",
  );

  copyWorkspaceManifestFixture(tempRoot);

  execFileSync(
    process.execPath,
    [
      resolve(repoRoot, "scripts/update-release-package-versions.ts"),
      "9.9.9-smoke.0",
      "--root",
      tempRoot,
    ],
    {
      cwd: repoRoot,
      stdio: "inherit",
    },
  );

  execFileSync("bun", ["install", "--ignore-scripts"], {
    cwd: tempRoot,
    stdio: "inherit",
  });

  const lockfile = readFileSync(resolve(tempRoot, "bun.lock"), "utf8");
  assertContains(
    lockfile,
    `"version": "9.9.9-smoke.0"`,
    "Expected bun.lock to contain the smoke version.",
  );

  const nightlyReleaseMetadata = execFileSync(
    process.execPath,
    [
      resolve(repoRoot, "scripts/resolve-nightly-release.ts"),
      "--date",
      "20260413",
      "--run-number",
      "321",
      "--sha",
      "abcdef1234567890",
      "--root",
      tempRoot,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
  assertContains(
    nightlyReleaseMetadata,
    "version=9.9.9-nightly.20260413.321",
    "Expected nightly metadata to contain the derived nightly version.",
  );
  assertContains(
    nightlyReleaseMetadata,
    "tag=nightly-v9.9.9-nightly.20260413.321",
    "Expected nightly metadata to contain the derived nightly tag.",
  );
  assertContains(
    nightlyReleaseMetadata,
    "name=T3 Code Nightly 9.9.9-nightly.20260413.321 (abcdef123456)",
    "Expected nightly metadata to include the short commit SHA in the release name.",
  );

  const gmackoReleaseMetadata = execFileSync(
    process.execPath,
    [
      resolve(repoRoot, "scripts/resolve-gmacko-release.ts"),
      "--stamp",
      "202604300228",
      "--root",
      tempRoot,
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
    },
  );
  assertContains(
    gmackoReleaseMetadata,
    "version=9.9.9-gmacko.202604300228",
    "Expected gmacko metadata to contain the derived gmacko version.",
  );
  assertContains(
    gmackoReleaseMetadata,
    "tag=v9.9.9-gmacko.202604300228",
    "Expected gmacko metadata to contain the derived gmacko tag.",
  );
  assertContains(
    gmackoReleaseMetadata,
    "name=T3 Code (gmacko) 9.9.9-gmacko.202604300228",
    "Expected gmacko metadata to contain the derived release name.",
  );

  const { arm64Path, x64Path } = writeMacManifestFixtures(tempRoot);
  execFileSync(
    process.execPath,
    [resolve(repoRoot, "scripts/merge-mac-update-manifests.ts"), arm64Path, x64Path],
    {
      cwd: repoRoot,
      stdio: "inherit",
    },
  );

  const mergedManifest = readFileSync(arm64Path, "utf8");
  assertContains(
    mergedManifest,
    "T3-Code-9.9.9-smoke.0-arm64.zip",
    "Merged manifest is missing the arm64 asset.",
  );
  assertContains(
    mergedManifest,
    "T3-Code-9.9.9-smoke.0-x64.zip",
    "Merged manifest is missing the x64 asset.",
  );

  console.log("Release smoke checks passed.");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
