import { describe, expect, it } from "vite-plus/test";

import { resolveDesktopAppDisplayName, resolveGitWorktreeName } from "./desktopAppIdentity.ts";

const fakeGit =
  (answers: Readonly<Record<string, string>>) => (_cwd: string, args: readonly string[]) => {
    const answer = answers[args.join(" ")];
    if (answer === undefined) throw new Error(`unexpected git ${args.join(" ")}`);
    return answer;
  };
const identity = (path: string) => path;

describe("desktop app display name", () => {
  it("keeps the base name in the main checkout", () => {
    const runGit = fakeGit({
      "rev-parse --git-dir": "/work/t3code/.git",
      "rev-parse --git-common-dir": "/work/t3code/.git",
    });
    expect(
      resolveDesktopAppDisplayName({
        cwd: "/work/t3code",
        baseDisplayName: "T3 Code (Dev)",
        runGit,
        realpath: identity,
      }),
    ).toBe("T3 Code (Dev)");
  });

  it("names a linked worktree by its checkout directory", () => {
    const runGit = fakeGit({
      "rev-parse --git-dir": "/work/t3code/.git/worktrees/feature-x",
      "rev-parse --git-common-dir": "/work/t3code/.git",
      "worktree list --porcelain":
        "worktree /work/t3code\nHEAD abc\nbranch refs/heads/main\n\nworktree /trees/t3code/feature-x\nHEAD def\n",
    });
    expect(
      resolveDesktopAppDisplayName({
        cwd: "/trees/t3code/feature-x",
        baseDisplayName: "T3 Code (Dev)",
        runGit,
        realpath: identity,
      }),
    ).toBe("T3 Code (Dev) - feature-x");
  });

  it("falls back to the git dir name when the worktree list is unavailable", () => {
    const runGit = (_cwd: string, args: readonly string[]) => {
      if (args[0] === "worktree") throw new Error("git worktree failed");
      return args[1] === "--git-dir" ? "/work/t3code/.git/worktrees/fallback" : "/work/t3code/.git";
    };
    expect(resolveGitWorktreeName("/elsewhere", { runGit, realpath: identity })).toBe("fallback");
  });

  it("keeps the base name outside a git checkout", () => {
    const runGit = () => {
      throw new Error("not a git repository");
    };
    expect(
      resolveDesktopAppDisplayName({ cwd: "/tmp", baseDisplayName: "T3 Code (Dev)", runGit }),
    ).toBe("T3 Code (Dev)");
  });
});
