import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RELEASE_VERSION_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function buildGmackoReleaseVersion(baseVersion: string, at: Date): string {
  const normalizedBaseVersion = baseVersion.trim();
  if (!RELEASE_VERSION_PATTERN.test(normalizedBaseVersion)) {
    throw new Error(`Invalid base release version: ${baseVersion}`);
  }

  if (Number.isNaN(at.getTime())) {
    throw new Error("Invalid release timestamp.");
  }

  const versionWithoutBuildMetadata =
    normalizedBaseVersion.split("+", 1)[0] ?? normalizedBaseVersion;
  const [coreVersion, existingPrerelease] = versionWithoutBuildMetadata.split("-", 2);
  const timestamp = [
    at.getUTCFullYear().toString().padStart(4, "0"),
    (at.getUTCMonth() + 1).toString().padStart(2, "0"),
    at.getUTCDate().toString().padStart(2, "0"),
    at.getUTCHours().toString().padStart(2, "0"),
    at.getUTCMinutes().toString().padStart(2, "0"),
  ].join("");

  const prereleaseSegments = [existingPrerelease, "gmacko", timestamp].filter(Boolean);
  return `${coreVersion}-${prereleaseSegments.join(".")}`;
}

export function shouldPublishGmackoRelease(input: {
  currentCommitish: string;
  latestPublishedCommitish: string;
}): boolean {
  const currentCommitish = input.currentCommitish.trim();
  const latestPublishedCommitish = input.latestPublishedCommitish.trim();
  if (!currentCommitish) {
    throw new Error("Current commitish is required.");
  }
  return latestPublishedCommitish === "" || latestPublishedCommitish !== currentCommitish;
}

function readBaseReleaseVersion(rootDir: string): string {
  const packageJsonPath = resolve(rootDir, "apps/server/package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
  if (typeof packageJson.version !== "string" || packageJson.version.trim() === "") {
    throw new Error(`Missing version in ${packageJsonPath}.`);
  }
  return packageJson.version.trim();
}

function writeGithubOutput(entries: Record<string, string>): void {
  const githubOutputPath = process.env.GITHUB_OUTPUT;
  if (!githubOutputPath) {
    throw new Error("GITHUB_OUTPUT is required when --github-output is set.");
  }

  for (const [key, value] of Object.entries(entries)) {
    appendFileSync(githubOutputPath, `${key}=${value}\n`);
  }
}

function parseVersionCommandArgs(argv: ReadonlyArray<string>): {
  rootDir: string;
  date: Date;
  writeGithubOutput: boolean;
} {
  let rootDir = process.cwd();
  let date = new Date();
  let writeGithubOutput = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument) continue;

    if (argument === "--root") {
      rootDir = argv[index + 1] ?? "";
      if (!rootDir) {
        throw new Error("Missing value for --root.");
      }
      index += 1;
      continue;
    }

    if (argument === "--date") {
      const rawDate = argv[index + 1] ?? "";
      if (!rawDate) {
        throw new Error("Missing value for --date.");
      }
      date = new Date(rawDate);
      index += 1;
      continue;
    }

    if (argument === "--github-output") {
      writeGithubOutput = true;
      continue;
    }

    throw new Error(`Unknown argument for version command: ${argument}`);
  }

  return { rootDir, date, writeGithubOutput };
}

function parsePublishCommandArgs(argv: ReadonlyArray<string>): {
  currentCommitish: string;
  latestPublishedCommitish: string;
  writeGithubOutput: boolean;
} {
  let currentCommitish: string | undefined;
  let latestPublishedCommitish = "";
  let writeGithubOutput = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument) continue;

    if (argument === "--latest-commitish") {
      latestPublishedCommitish = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (argument === "--github-output") {
      writeGithubOutput = true;
      continue;
    }

    if (argument.startsWith("--")) {
      throw new Error(`Unknown argument for publish command: ${argument}`);
    }

    if (currentCommitish !== undefined) {
      throw new Error("Only one current commitish can be provided.");
    }
    currentCommitish = argument;
  }

  if (!currentCommitish) {
    throw new Error(
      "Usage: node scripts/gmackoRelease.ts publish <current-commitish> [--latest-commitish <sha>] [--github-output]",
    );
  }

  return { currentCommitish, latestPublishedCommitish, writeGithubOutput };
}

function main(argv: ReadonlyArray<string>): void {
  const [command, ...rest] = argv;

  if (command === "version") {
    const options = parseVersionCommandArgs(rest);
    const version = buildGmackoReleaseVersion(
      readBaseReleaseVersion(options.rootDir),
      options.date,
    );
    const outputs = {
      version,
      tag: `v${version}`,
    };

    if (options.writeGithubOutput) {
      writeGithubOutput(outputs);
    } else {
      console.log(JSON.stringify(outputs));
    }
    return;
  }

  if (command === "publish") {
    const options = parsePublishCommandArgs(rest);
    const publish = shouldPublishGmackoRelease(options);
    const outputs = {
      publish: publish ? "true" : "false",
    };

    if (options.writeGithubOutput) {
      writeGithubOutput(outputs);
    } else {
      console.log(JSON.stringify(outputs));
    }
    return;
  }

  throw new Error("Usage: node scripts/gmackoRelease.ts <version|publish> [...args]");
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main(process.argv.slice(2));
}
