import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import * as VcsProcess from "../vcs/VcsProcess.ts";

type GitIdentityResolution =
  | { readonly _tag: "Repository"; readonly commonDirectory: string }
  | { readonly _tag: "NotRepository" }
  | { readonly _tag: "OperationalFailure" };

export interface RepositoryIdentityMatcher {
  readonly matches: (candidateCwd: string) => Effect.Effect<boolean>;
}

const isContainedBy = (path: Path.Path, root: string, candidate: string): boolean => {
  const relativePath = path.relative(root, candidate);
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== ".." &&
      !path.isAbsolute(relativePath))
  );
};

const MAX_CANDIDATE_CACHE_ENTRIES = 512;
const DETERMINISTIC_GIT_LOCALE = { LC_ALL: "C", LANG: "C" } satisfies NodeJS.ProcessEnv;

/**
 * Resolves the selected project's identity once and returns a reusable matcher.
 * Operational Git failures fail closed and are distinct from a definite non-repository result.
 */
export const prepareRepositoryIdentityMatcher = Effect.fn(
  "RepositoryIdentity.prepareRepositoryIdentityMatcher",
)(function* (projectRoot: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const process = yield* VcsProcess.VcsProcess;

  const canonicalDirectory = Effect.fn("RepositoryIdentity.canonicalDirectory")(
    function* (directory: string) {
      const canonicalPath = yield* fileSystem.realPath(directory);
      const stat = yield* fileSystem.stat(canonicalPath);
      return stat.type === "Directory" ? canonicalPath : undefined;
    },
    Effect.orElseSucceed(() => undefined),
  );

  const resolveGitIdentity = Effect.fn("RepositoryIdentity.resolveGitIdentity")(function* (
    cwd: string,
  ): Effect.fn.Return<GitIdentityResolution> {
    const result = yield* process
      .run({
        operation: "thread-import.repository-identity",
        command: "git",
        args: ["rev-parse", "--git-common-dir"],
        cwd,
        env: DETERMINISTIC_GIT_LOCALE,
        allowNonZeroExit: true,
        timeoutMs: 5_000,
      })
      .pipe(Effect.orElseSucceed(() => undefined));
    if (result === undefined) {
      return { _tag: "OperationalFailure" };
    }
    if (result.exitCode !== 0) {
      return result.stderr.toLocaleLowerCase("en-US").includes("not a git repository")
        ? { _tag: "NotRepository" }
        : { _tag: "OperationalFailure" };
    }

    const commonDirectory = yield* canonicalDirectory(path.resolve(cwd, result.stdout.trim()));
    return commonDirectory === undefined
      ? { _tag: "OperationalFailure" }
      : { _tag: "Repository", commonDirectory };
  });

  const canonicalProjectRoot = yield* canonicalDirectory(projectRoot);
  if (canonicalProjectRoot === undefined) {
    return { matches: () => Effect.succeed(false) } satisfies RepositoryIdentityMatcher;
  }

  const projectIdentity = yield* resolveGitIdentity(canonicalProjectRoot);
  if (projectIdentity._tag === "OperationalFailure") {
    return { matches: () => Effect.succeed(false) } satisfies RepositoryIdentityMatcher;
  }

  const candidateCache = new Map<string, GitIdentityResolution>();
  const resolveCandidate = Effect.fn("RepositoryIdentity.resolveCandidate")(function* (
    candidateCwd: string,
  ) {
    const cached = candidateCache.get(candidateCwd);
    if (cached !== undefined) {
      return cached;
    }
    const resolved = yield* resolveGitIdentity(candidateCwd);
    if (candidateCache.size >= MAX_CANDIDATE_CACHE_ENTRIES) {
      const oldestKey = candidateCache.keys().next().value;
      if (oldestKey !== undefined) {
        candidateCache.delete(oldestKey);
      }
    }
    candidateCache.set(candidateCwd, resolved);
    return resolved;
  });

  const matches = Effect.fn("RepositoryIdentityMatcher.matches")(function* (candidateCwd: string) {
    const canonicalCandidateCwd = yield* canonicalDirectory(candidateCwd);
    if (canonicalCandidateCwd === undefined) {
      return false;
    }

    const candidateIdentity = yield* resolveCandidate(canonicalCandidateCwd);
    if (candidateIdentity._tag === "OperationalFailure") {
      return false;
    }
    if (projectIdentity._tag === "Repository") {
      return (
        candidateIdentity._tag === "Repository" &&
        candidateIdentity.commonDirectory === projectIdentity.commonDirectory
      );
    }
    return (
      candidateIdentity._tag === "NotRepository" &&
      isContainedBy(path, canonicalProjectRoot, canonicalCandidateCwd)
    );
  });

  return { matches } satisfies RepositoryIdentityMatcher;
});

/** Convenience wrapper for callers matching only one candidate. */
export const matchesRepositoryIdentity = Effect.fn("RepositoryIdentity.matchesRepositoryIdentity")(
  function* (projectRoot: string, candidateCwd: string) {
    const matcher = yield* prepareRepositoryIdentityMatcher(projectRoot);
    return yield* matcher.matches(candidateCwd);
  },
);
