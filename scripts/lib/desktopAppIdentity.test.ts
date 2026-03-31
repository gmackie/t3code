import { describe, expect, it } from "vitest";

import { resolveDesktopAppDisplayName, resolveGitWorktreeName } from "./desktopAppIdentity.ts";

type RunGit = (cwd: string, args: readonly string[]) => string;

function createRunGit(responses: Record<string, string>): RunGit {
  return (_cwd, args) => {
    const key = args.join(" ");
    const response = responses[key];
    if (response === undefined) {
      throw new Error(`Unexpected git command: ${key}`);
    }
    return response;
  };
}

const throwNotARepo: RunGit = () => {
  throw new Error("fatal: not a git repository");
};

describe("resolveGitWorktreeName", () => {
  it("returns null when git-dir matches git-common-dir", () => {
    const runGit = createRunGit({
      "rev-parse --git-dir": ".git",
      "rev-parse --git-common-dir": ".git",
    });

    expect(
      resolveGitWorktreeName("/repo", {
        runGit,
        realpath: (path) => path,
      }),
    ).toBeNull();
  });

  it("uses the current worktree directory name when git reports a linked worktree", () => {
    const runGit = createRunGit({
      "rev-parse --git-dir": "/repo/.git/worktrees/restart-provider-session",
      "rev-parse --git-common-dir": "/repo/.git",
      "worktree list --porcelain": [
        "worktree /repo",
        "HEAD 1111111",
        "branch refs/heads/main",
        "",
        "worktree /Users/me/worktrees/restart-provider-session",
        "HEAD 2222222",
        "branch refs/heads/restart-provider-session",
      ].join("\n"),
    });

    expect(
      resolveGitWorktreeName("/Users/me/worktrees/restart-provider-session", {
        runGit,
        realpath: (path) => path,
      }),
    ).toBe("restart-provider-session");
  });

  it("supports linked worktrees whose path contains spaces", () => {
    const runGit = createRunGit({
      "rev-parse --git-dir": "/repo/.git/worktrees/feature-with-spaces",
      "rev-parse --git-common-dir": "/repo/.git",
      "worktree list --porcelain": [
        "worktree /repo",
        "HEAD 1111111",
        "branch refs/heads/main",
        "",
        "worktree /Users/me/Code Worktrees/feature with spaces",
        "HEAD 2222222",
        "branch refs/heads/feature-with-spaces",
      ].join("\n"),
    });

    expect(
      resolveGitWorktreeName("/Users/me/Code Worktrees/feature with spaces", {
        runGit,
        realpath: (path) => path,
      }),
    ).toBe("feature with spaces");
  });

  it("falls back to the git-dir basename when parsing worktree output fails", () => {
    const runGit = createRunGit({
      "rev-parse --git-dir": "/repo/.git/worktrees/fallback-name",
      "rev-parse --git-common-dir": "/repo/.git",
      "worktree list --porcelain": "not valid porcelain",
    });

    expect(
      resolveGitWorktreeName("/Users/me/worktrees/fallback-name", {
        runGit,
        realpath: (path) => path,
      }),
    ).toBe("fallback-name");
  });

  it("returns null when git commands fail outside a repository", () => {
    expect(
      resolveGitWorktreeName("/tmp/not-a-repo", {
        runGit: throwNotARepo,
        realpath: (path) => path,
      }),
    ).toBeNull();
  });
});

describe("resolveDesktopAppDisplayName", () => {
  it("keeps the base display name for the main checkout", () => {
    const runGit = createRunGit({
      "rev-parse --git-dir": ".git",
      "rev-parse --git-common-dir": ".git",
    });

    expect(
      resolveDesktopAppDisplayName({
        cwd: "/repo",
        baseDisplayName: "T3 Code (Alpha)",
        runGit,
        realpath: (path) => path,
      }),
    ).toBe("T3 Code (Alpha)");
  });

  it("appends the worktree name for linked worktrees", () => {
    const runGit = createRunGit({
      "rev-parse --git-dir": "/repo/.git/worktrees/restart-provider-session",
      "rev-parse --git-common-dir": "/repo/.git",
      "worktree list --porcelain": [
        "worktree /repo",
        "HEAD 1111111",
        "branch refs/heads/main",
        "",
        "worktree /Users/me/worktrees/restart-provider-session",
        "HEAD 2222222",
        "branch refs/heads/restart-provider-session",
      ].join("\n"),
    });

    expect(
      resolveDesktopAppDisplayName({
        cwd: "/Users/me/worktrees/restart-provider-session",
        baseDisplayName: "T3 Code (Alpha)",
        runGit,
        realpath: (path) => path,
      }),
    ).toBe("T3 Code (Alpha) - restart-provider-session");
  });
});
