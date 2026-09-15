// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

interface DesktopAppIdentityOptions {
  readonly runGit?: (cwd: string, args: readonly string[]) => string;
  readonly realpath?: (targetPath: string) => string;
}

function defaultRunGit(cwd: string, args: readonly string[]): string {
  return NodeChildProcess.execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function defaultRealpath(targetPath: string): string {
  return NodeFS.realpathSync.native(targetPath);
}

function resolveGitPath(cwd: string, gitPath: string): string {
  if (NodePath.isAbsolute(gitPath)) {
    return NodePath.normalize(gitPath);
  }

  return NodePath.resolve(cwd, gitPath);
}

function parsePorcelainWorktreePaths(output: string): string[] {
  return output
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).trim())
    .filter((line) => line.length > 0);
}

function getPathRealpath(targetPath: string, realpath: (targetPath: string) => string): string {
  try {
    return realpath(targetPath);
  } catch {
    return NodePath.resolve(targetPath);
  }
}

export function resolveGitWorktreeName(
  cwd: string,
  options: DesktopAppIdentityOptions = {},
): string | null {
  const runGit = options.runGit ?? defaultRunGit;
  const getRealpath = options.realpath ?? defaultRealpath;

  try {
    const gitDir = resolveGitPath(cwd, runGit(cwd, ["rev-parse", "--git-dir"]));
    const gitCommonDir = resolveGitPath(cwd, runGit(cwd, ["rev-parse", "--git-common-dir"]));

    if (gitDir === gitCommonDir) {
      return null;
    }

    const currentWorktreePath = getPathRealpath(cwd, getRealpath);

    try {
      const porcelain = runGit(cwd, ["worktree", "list", "--porcelain"]);
      const matchingPath = parsePorcelainWorktreePaths(porcelain).find(
        (candidate) => getPathRealpath(candidate, getRealpath) === currentWorktreePath,
      );

      if (matchingPath) {
        return NodePath.basename(matchingPath);
      }
    } catch {
      // Fall through to the git-dir basename fallback for linked worktrees.
    }

    return NodePath.basename(gitDir);
  } catch {
    return null;
  }
}

interface ResolveDesktopAppDisplayNameInput extends DesktopAppIdentityOptions {
  readonly cwd: string;
  readonly baseDisplayName: string;
}

export function resolveDesktopAppDisplayName(input: ResolveDesktopAppDisplayNameInput): string {
  void input;
  return input.baseDisplayName;
}
