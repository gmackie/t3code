// @effect-diagnostics nodeBuiltinImport:off
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const workspaceFiles = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "apps/server/package.json",
  "apps/desktop/package.json",
  "apps/web/package.json",
  "apps/mobile/package.json",
  "apps/mobile/deps/react-native-nitro-markdown-0.5.0.tgz",
  "apps/mobile/modules/t3-review-diff/package.json",
  "apps/mobile/modules/t3-terminal/package.json",
  "apps/marketing/package.json",
  "oxlint-plugin-t3code/package.json",
  "packages/client-runtime/package.json",
  "packages/contracts/package.json",
  "packages/shared/package.json",
  "packages/ssh/package.json",
  "packages/tailscale/package.json",
  "packages/effect-acp/package.json",
  "packages/effect-codex-app-server/package.json",
  "packages/ext-browser/package.json",
  "packages/ext-planning-workbench/package.json",
  "packages/ext-preview-workspace/package.json",
  "packages/ext-thread-overview/package.json",
  "packages/extension-api/package.json",
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

  const patchesDirectory = resolve(repoRoot, "patches");
  if (existsSync(patchesDirectory)) {
    cpSync(patchesDirectory, resolve(targetRoot, "patches"), { recursive: true });
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

function writeWindowsManifestFixtures(
  targetRoot: string,
  channel: string,
): { arm64Path: string; x64Path: string } {
  const assetDirectory = resolve(targetRoot, "release-assets");
  mkdirSync(assetDirectory, { recursive: true });

  const arm64Path = resolve(assetDirectory, `${channel}-win-arm64.yml`);
  const x64Path = resolve(assetDirectory, `${channel}-win-x64.yml`);

  writeFileSync(
    arm64Path,
    `version: 9.9.9-smoke.0
files:
  - url: T3-Code-9.9.9-smoke.0-arm64.exe
    sha512: arm64exe
    size: 126621344
  - url: T3-Code-9.9.9-smoke.0-arm64.exe.blockmap
    sha512: arm64blockmap
    size: 152344
path: T3-Code-9.9.9-smoke.0-arm64.exe
sha512: arm64exe
releaseDate: '2026-03-08T10:32:14.587Z'
`,
  );

  writeFileSync(
    x64Path,
    `version: 9.9.9-smoke.0
files:
  - url: T3-Code-9.9.9-smoke.0-x64.exe
    sha512: x64exe
    size: 132000112
  - url: T3-Code-9.9.9-smoke.0-x64.exe.blockmap
    sha512: x64blockmap
    size: 160112
path: T3-Code-9.9.9-smoke.0-x64.exe
sha512: x64exe
releaseDate: '2026-03-08T10:36:07.540Z'
`,
  );

  return { arm64Path, x64Path };
}

function writeWindowsBuilderDebugFixtures(targetRoot: string): {
  arm64Path: string;
  x64Path: string;
} {
  const assetDirectory = resolve(targetRoot, "release-assets");
  mkdirSync(assetDirectory, { recursive: true });

  const arm64Path = resolve(assetDirectory, "builder-debug-win-arm64.yml");
  const x64Path = resolve(assetDirectory, "builder-debug-win-x64.yml");
  const debugFixture = `arm64:
  firstOrDefaultFilePatterns:
    - '**/*'
nsis:
  script: |-
    !include "example.nsh"
`;

  writeFileSync(arm64Path, debugFixture);
  writeFileSync(x64Path, debugFixture);

  return { arm64Path, x64Path };
}
function assertContains(haystack: string, needle: string, message: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(message);
  }
}

function assertExists(path: string, message: string): void {
  if (!existsSync(path)) {
    throw new Error(message);
  }
}

function assertPackageVersion(path: string, version: string): void {
  const packageJson = JSON.parse(readFileSync(path, "utf8")) as {
    readonly version?: unknown;
  };

  if (packageJson.version !== version) {
    throw new Error(`Expected ${path} to have version ${version}.`);
  }
}

function assertMissing(path: string, message: string): void {
  if (existsSync(path)) {
    throw new Error(message);
  }
}

function assertWorkflowSupportsGmackoForkReleases(): void {
  const workflow = readFileSync(resolve(repoRoot, ".github/workflows/release.yml"), "utf8");
  const gmackoSyncWorkflow = readFileSync(
    resolve(repoRoot, ".github/workflows/gmacko-sync-upstream.yml"),
    "utf8",
  );
  assertContains(workflow, "- gmacko", "Release workflow is missing the gmacko channel option.");
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
    workflow,
    "steps.release_token.outputs.token",
    "Release workflow does not use the fork-compatible release token fallback.",
  );
  assertContains(
    workflow,
    "contents: write",
    "Release workflow does not grant content write permission needed to publish gmacko releases.",
  );
  assertContains(
    workflow,
    "id-token: write",
    "Release workflow does not grant id-token permission needed by the release lane.",
  );
  assertContains(
    workflow,
    "T3CODE_DESKTOP_UPDATE_REPOSITORY=gmackie/t3code",
    "Release workflow does not point gmacko updater metadata at the fork repository.",
  );
  assertContains(
    workflow,
    "if: github.event_name == 'schedule' && github.repository == 'pingdotgg/t3code'",
    "Release workflow does not keep scheduled nightly releases scoped to the upstream repository.",
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
    "git merge --no-edit -X theirs upstream/main",
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
}

const tempRoot = mkdtempSync(join(tmpdir(), "t3-release-smoke-"));

try {
  assertWorkflowSupportsGmackoForkReleases();

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

  rmSync(resolve(tempRoot, "pnpm-lock.yaml"), { force: true });

  execFileSync("vp", ["install", "--lockfile-only", "--ignore-scripts"], {
    cwd: tempRoot,
    stdio: "inherit",
  });

  const lockfile = readFileSync(resolve(tempRoot, "pnpm-lock.yaml"), "utf8");
  assertContains(lockfile, "lockfileVersion:", "Expected pnpm-lock.yaml to be regenerated.");

  for (const relativePath of [
    "apps/server/package.json",
    "apps/desktop/package.json",
    "apps/web/package.json",
    "packages/contracts/package.json",
  ]) {
    assertPackageVersion(resolve(tempRoot, relativePath), "9.9.9-smoke.0");
  }

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
    "version=9.9.10-nightly.20260413.321",
    "Expected nightly metadata to contain the derived nightly version.",
  );
  assertContains(
    nightlyReleaseMetadata,
    "tag=v9.9.10-nightly.20260413.321",
    "Expected nightly metadata to contain the derived nightly tag.",
  );
  assertContains(
    nightlyReleaseMetadata,
    "name=T3 Code Nightly 9.9.10-nightly.20260413.321 (abcdef123456)",
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
    [
      resolve(repoRoot, "scripts/merge-update-manifests.ts"),
      "--platform",
      "mac",
      arm64Path,
      x64Path,
    ],
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

  const { arm64Path: winArm64Path, x64Path: winX64Path } = writeWindowsManifestFixtures(
    tempRoot,
    "latest",
  );
  const mergedWindowsManifestPath = resolve(tempRoot, "release-assets/latest.yml");
  const { arm64Path: nightlyWinArm64Path, x64Path: nightlyWinX64Path } =
    writeWindowsManifestFixtures(tempRoot, "nightly");
  const mergedNightlyWindowsManifestPath = resolve(tempRoot, "release-assets/nightly.yml");
  const { arm64Path: previewWinArm64Path, x64Path: previewWinX64Path } =
    writeWindowsManifestFixtures(tempRoot, "preview");
  const mergedPreviewWindowsManifestPath = resolve(tempRoot, "release-assets/preview.yml");
  const { arm64Path: winDebugArm64Path, x64Path: winDebugX64Path } =
    writeWindowsBuilderDebugFixtures(tempRoot);
  execFileSync(
    "bash",
    [
      "-lc",
      `
        release_assets_dir=${JSON.stringify(resolve(tempRoot, "release-assets"))}
        shopt -s nullglob
        found_windows_manifest=false
        for x64_manifest in "$release_assets_dir"/*-win-x64.yml; do
          if [[ "$(basename "$x64_manifest")" == builder-debug-* ]]; then
            continue
          fi

          arm64_manifest="\${x64_manifest/-x64.yml/-arm64.yml}"
          output_manifest="\${x64_manifest/-win-x64.yml/.yml}"
          if [[ ! -f "$arm64_manifest" ]]; then
            echo "Missing matching arm64 Windows manifest for $x64_manifest" >&2
            exit 1
          fi

          found_windows_manifest=true
          ${JSON.stringify(process.execPath)} ${JSON.stringify(resolve(repoRoot, "scripts/merge-update-manifests.ts"))} --platform win \
            "$arm64_manifest" \
            "$x64_manifest" \
            "$output_manifest"
          rm -f "$arm64_manifest" "$x64_manifest"
        done

        if [[ "$found_windows_manifest" != true ]]; then
          echo "No Windows updater manifests found to merge." >&2
          exit 1
        fi
      `,
    ],
    {
      cwd: repoRoot,
      stdio: "inherit",
    },
  );

  const mergedWindowsManifest = readFileSync(mergedWindowsManifestPath, "utf8");
  assertContains(
    mergedWindowsManifest,
    "T3-Code-9.9.9-smoke.0-arm64.exe",
    "Merged Windows manifest is missing the arm64 asset.",
  );
  assertContains(
    mergedWindowsManifest,
    "T3-Code-9.9.9-smoke.0-x64.exe",
    "Merged Windows manifest is missing the x64 asset.",
  );
  const mergedNightlyWindowsManifest = readFileSync(mergedNightlyWindowsManifestPath, "utf8");
  assertContains(
    mergedNightlyWindowsManifest,
    "T3-Code-9.9.9-smoke.0-arm64.exe",
    "Merged nightly Windows manifest is missing the arm64 asset.",
  );
  assertContains(
    mergedNightlyWindowsManifest,
    "T3-Code-9.9.9-smoke.0-x64.exe",
    "Merged nightly Windows manifest is missing the x64 asset.",
  );
  const mergedPreviewWindowsManifest = readFileSync(mergedPreviewWindowsManifestPath, "utf8");
  assertContains(
    mergedPreviewWindowsManifest,
    "T3-Code-9.9.9-smoke.0-arm64.exe",
    "Merged preview Windows manifest is missing the arm64 asset.",
  );
  assertContains(
    mergedPreviewWindowsManifest,
    "T3-Code-9.9.9-smoke.0-x64.exe",
    "Merged preview Windows manifest is missing the x64 asset.",
  );
  assertMissing(
    winArm64Path,
    "Windows release smoke unexpectedly kept the arm64 updater manifest.",
  );
  assertMissing(winX64Path, "Windows release smoke unexpectedly kept the x64 updater manifest.");
  assertMissing(
    nightlyWinArm64Path,
    "Windows release smoke unexpectedly kept the nightly arm64 updater manifest.",
  );
  assertMissing(
    nightlyWinX64Path,
    "Windows release smoke unexpectedly kept the nightly x64 updater manifest.",
  );
  assertMissing(
    previewWinArm64Path,
    "Windows release smoke unexpectedly kept the preview arm64 updater manifest.",
  );
  assertMissing(
    previewWinX64Path,
    "Windows release smoke unexpectedly kept the preview x64 updater manifest.",
  );
  assertExists(
    winDebugArm64Path,
    "Windows release smoke unexpectedly removed the arm64 builder debug fixture.",
  );
  assertExists(
    winDebugX64Path,
    "Windows release smoke unexpectedly removed the x64 builder debug fixture.",
  );

  Effect.runSync(Console.log("Release smoke checks passed."));
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
