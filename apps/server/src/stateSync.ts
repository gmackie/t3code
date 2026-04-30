import { cp, mkdir, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type T3StateProfile = "stable" | "gmacko";

export interface ResolvedT3StateProfile {
  readonly baseDir: string;
  readonly stateDir: string;
}

export interface T3StateSyncResult {
  readonly copiedFiles: ReadonlyArray<string>;
  readonly skippedFiles: ReadonlyArray<string>;
}

export interface T3StateSyncCliArgs {
  readonly sourceStateDir: string;
  readonly targetStateDir: string;
  readonly dryRun: boolean;
  readonly includeLogs: boolean;
}

const PROFILE_DEFAULTS: Record<
  T3StateProfile,
  { readonly baseDirName: string; readonly stateDirName: string }
> = {
  stable: {
    baseDirName: ".t3",
    stateDirName: "userdata",
  },
  gmacko: {
    baseDirName: ".t3-gmacko",
    stateDirName: "userdata-gmacko",
  },
};

const DEFAULT_EXCLUDED_TOP_LEVEL_NAMES = new Set(["logs"]);

function toPortableRelativePath(relativePath: string): string {
  return relativePath.split(path.sep).join("/");
}

function shouldSkipRelativePath(
  relativePath: string,
  excludedTopLevelNames: ReadonlySet<string>,
): boolean {
  const [topLevelName] = relativePath.split(path.sep);
  return topLevelName !== undefined && excludedTopLevelNames.has(topLevelName);
}

async function collectSourceFiles(input: {
  readonly rootDir: string;
  readonly currentDir: string;
  readonly excludedTopLevelNames: ReadonlySet<string>;
  readonly copiedFiles: string[];
  readonly skippedFiles: string[];
}): Promise<void> {
  for (const entry of await readdir(input.currentDir, { withFileTypes: true })) {
    const absolutePath = path.join(input.currentDir, entry.name);
    const relativePath = path.relative(input.rootDir, absolutePath);
    const portableRelativePath = toPortableRelativePath(relativePath);

    if (shouldSkipRelativePath(relativePath, input.excludedTopLevelNames)) {
      input.skippedFiles.push(portableRelativePath);
      continue;
    }

    if (entry.isDirectory()) {
      await collectSourceFiles({
        ...input,
        currentDir: absolutePath,
      });
      continue;
    }

    if (entry.isFile()) {
      input.copiedFiles.push(portableRelativePath);
    }
  }
}

export function resolveT3StateProfile(
  profile: T3StateProfile,
  options?: { readonly homeDir?: string },
): ResolvedT3StateProfile {
  const defaults = PROFILE_DEFAULTS[profile];
  const baseDir = path.join(options?.homeDir ?? os.homedir(), defaults.baseDirName);
  return {
    baseDir,
    stateDir: path.join(baseDir, defaults.stateDirName),
  };
}

function resolveStateEndpoint(value: string): string {
  if (value === "stable" || value === "gmacko") {
    return resolveT3StateProfile(value).stateDir;
  }
  return path.resolve(value);
}

function readFlagValue(args: ReadonlyArray<string>, flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

export function parseT3StateSyncCliArgs(args: ReadonlyArray<string>): T3StateSyncCliArgs {
  const from = readFlagValue(args, "--from");
  const to = readFlagValue(args, "--to");
  if (!from || from.startsWith("--")) {
    throw new Error("Missing --from. Use stable, gmacko, or an explicit state directory path.");
  }
  if (!to || to.startsWith("--")) {
    throw new Error("Missing --to. Use stable, gmacko, or an explicit state directory path.");
  }

  return {
    sourceStateDir: resolveStateEndpoint(from),
    targetStateDir: resolveStateEndpoint(to),
    dryRun: args.includes("--dry-run"),
    includeLogs: args.includes("--include-logs"),
  };
}

export async function syncT3State(input: {
  readonly sourceStateDir: string;
  readonly targetStateDir: string;
  readonly includeLogs?: boolean;
  readonly dryRun?: boolean;
}): Promise<T3StateSyncResult> {
  const sourceStat = await stat(input.sourceStateDir);
  if (!sourceStat.isDirectory()) {
    throw new Error(`Source state path is not a directory: ${input.sourceStateDir}`);
  }

  const excludedTopLevelNames = input.includeLogs
    ? new Set<string>()
    : DEFAULT_EXCLUDED_TOP_LEVEL_NAMES;
  const copiedFiles: string[] = [];
  const skippedFiles: string[] = [];

  await collectSourceFiles({
    rootDir: input.sourceStateDir,
    currentDir: input.sourceStateDir,
    excludedTopLevelNames,
    copiedFiles,
    skippedFiles,
  });

  if (input.dryRun) {
    return { copiedFiles, skippedFiles };
  }

  await mkdir(input.targetStateDir, { recursive: true });
  await cp(input.sourceStateDir, input.targetStateDir, {
    recursive: true,
    force: true,
    filter: (sourcePath) => {
      const relativePath = path.relative(input.sourceStateDir, sourcePath);
      if (relativePath === "") {
        return true;
      }
      return !shouldSkipRelativePath(relativePath, excludedTopLevelNames);
    },
  });

  return { copiedFiles, skippedFiles };
}
