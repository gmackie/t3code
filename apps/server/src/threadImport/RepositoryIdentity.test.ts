import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as VcsProcess from "../vcs/VcsProcess.ts";
import {
  matchesRepositoryIdentity,
  prepareRepositoryIdentityMatcher,
} from "./RepositoryIdentity.ts";

const TestLayer = VcsProcess.layer.pipe(Layer.provideMerge(NodeServices.layer));

const makeTempDirectory = Effect.fn("RepositoryIdentityTest.makeTempDirectory")(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3code-repository-identity-" });
});

const git = Effect.fn("RepositoryIdentityTest.git")(function* (
  cwd: string,
  ...args: ReadonlyArray<string>
) {
  const process = yield* VcsProcess.VcsProcess;
  yield* process.run({
    operation: "test.repository-identity",
    command: "git",
    args,
    cwd,
  });
});

const initRepository = Effect.fn("RepositoryIdentityTest.initRepository")(function* (
  directory: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* git(directory, "init", "--quiet");
  yield* git(directory, "config", "user.email", "tests@t3code.local");
  yield* git(directory, "config", "user.name", "T3 Code Tests");
  yield* fileSystem.writeFileString(path.join(directory, "README.md"), "fixture\n");
  yield* git(directory, "add", "README.md");
  yield* git(directory, "commit", "--quiet", "-m", "fixture");
});

it.layer(TestLayer)("matchesRepositoryIdentity", (it) => {
  it.effect("matches the repository root and its subdirectories", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const projectRoot = yield* makeTempDirectory();
        yield* initRepository(projectRoot);
        const candidateCwd = path.join(projectRoot, "packages", "example");
        yield* fileSystem.makeDirectory(candidateCwd, { recursive: true });

        expect(yield* matchesRepositoryIdentity(projectRoot, projectRoot)).toBe(true);
        expect(yield* matchesRepositoryIdentity(projectRoot, candidateCwd)).toBe(true);
      }),
    ),
  );

  it.effect("matches linked worktrees using their shared Git common directory", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const projectRoot = yield* makeTempDirectory();
        yield* initRepository(projectRoot);
        const worktreeParent = yield* makeTempDirectory();
        const linkedWorktree = path.join(worktreeParent, "linked");
        yield* git(projectRoot, "worktree", "add", "--quiet", "--detach", linkedWorktree, "HEAD");

        expect(yield* matchesRepositoryIdentity(projectRoot, linkedWorktree)).toBe(true);
      }),
    ),
  );

  it.effect("excludes an independent repository nested beneath the project", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const projectRoot = yield* makeTempDirectory();
        yield* initRepository(projectRoot);
        const nestedRepository = path.join(projectRoot, "vendor", "independent");
        yield* fileSystem.makeDirectory(nestedRepository, { recursive: true });
        yield* initRepository(nestedRepository);

        expect(yield* matchesRepositoryIdentity(projectRoot, nestedRepository)).toBe(false);
      }),
    ),
  );

  it.effect("uses path containment when the project root is not a Git repository", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const parent = yield* makeTempDirectory();
        const projectRoot = path.join(parent, "project");
        const candidateCwd = path.join(projectRoot, "nested", "directory");
        const sibling = path.join(parent, "project-copy");
        yield* fileSystem.makeDirectory(candidateCwd, { recursive: true });
        yield* fileSystem.makeDirectory(sibling, { recursive: true });

        expect(yield* matchesRepositoryIdentity(projectRoot, candidateCwd)).toBe(true);
        expect(yield* matchesRepositoryIdentity(projectRoot, sibling)).toBe(false);
      }),
    ),
  );

  it.effect("excludes a nested Git repository from a non-Git project", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const projectRoot = yield* makeTempDirectory();
        const nestedRepository = path.join(projectRoot, "nested-repository");
        yield* fileSystem.makeDirectory(nestedRepository, { recursive: true });
        yield* initRepository(nestedRepository);

        expect(yield* matchesRepositoryIdentity(projectRoot, nestedRepository)).toBe(false);
      }),
    ),
  );

  it.effect("fails closed when Git cannot be started", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const projectRoot = yield* makeTempDirectory();
        const candidateCwd = path.join(projectRoot, "candidate");
        yield* fileSystem.makeDirectory(candidateCwd, { recursive: true });
        const unavailableGit = VcsProcess.VcsProcess.of({
          run: () => Effect.fail(undefined as never),
        });

        const matches = yield* matchesRepositoryIdentity(projectRoot, candidateCwd).pipe(
          Effect.provideService(VcsProcess.VcsProcess, unavailableGit),
        );

        expect(matches).toBe(false);
      }),
    ),
  );

  it.effect("resolves the project once when matching multiple candidates", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const projectRoot = yield* makeTempDirectory();
        const firstCandidate = path.join(projectRoot, "first");
        const secondCandidate = path.join(projectRoot, "second");
        yield* fileSystem.makeDirectory(firstCandidate, { recursive: true });
        yield* fileSystem.makeDirectory(secondCandidate, { recursive: true });
        let processRuns = 0;
        const nonGitProcess = VcsProcess.VcsProcess.of({
          run: () => {
            processRuns += 1;
            return Effect.succeed({
              exitCode: 128 as never,
              stdout: "",
              stderr: "fatal: not a git repository (or any of the parent directories): .git",
              stdoutTruncated: false,
              stderrTruncated: false,
            });
          },
        });

        const matcher = yield* prepareRepositoryIdentityMatcher(projectRoot).pipe(
          Effect.provideService(VcsProcess.VcsProcess, nonGitProcess),
        );
        expect(yield* matcher.matches(firstCandidate)).toBe(true);
        expect(yield* matcher.matches(secondCandidate)).toBe(true);
        expect(processRuns).toBe(3);
      }),
    ),
  );

  it.effect("classifies non-repositories case-insensitively under a deterministic Git locale", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const projectRoot = yield* makeTempDirectory();
        const candidateCwd = path.join(projectRoot, "candidate");
        yield* fileSystem.makeDirectory(candidateCwd, { recursive: true });
        const commandEnvironments: Array<NodeJS.ProcessEnv | undefined> = [];
        const nonGitProcess = VcsProcess.VcsProcess.of({
          run: (input) => {
            commandEnvironments.push(input.env);
            return Effect.succeed({
              exitCode: 128 as never,
              stdout: "",
              stderr: "FATAL: NOT A GIT REPOSITORY (OR ANY OF THE PARENT DIRECTORIES): .GIT",
              stdoutTruncated: false,
              stderrTruncated: false,
            });
          },
        });

        const matches = yield* matchesRepositoryIdentity(projectRoot, candidateCwd).pipe(
          Effect.provideService(VcsProcess.VcsProcess, nonGitProcess),
        );

        expect(matches).toBe(true);
        expect(commandEnvironments).toHaveLength(2);
        expect(commandEnvironments).toEqual([
          { LC_ALL: "C", LANG: "C" },
          { LC_ALL: "C", LANG: "C" },
        ]);
      }),
    ),
  );

  it.effect("does not treat a symlink escaping a non-Git project as contained", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const parent = yield* makeTempDirectory();
        const projectRoot = path.join(parent, "project");
        const outsideDirectory = path.join(parent, "outside");
        const linkedOutside = path.join(projectRoot, "linked-outside");
        yield* fileSystem.makeDirectory(projectRoot, { recursive: true });
        yield* fileSystem.makeDirectory(outsideDirectory, { recursive: true });
        yield* fileSystem.symlink(outsideDirectory, linkedOutside);

        expect(yield* matchesRepositoryIdentity(projectRoot, linkedOutside)).toBe(false);
      }),
    ),
  );

  it.effect("returns false for missing paths instead of failing", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const projectRoot = yield* makeTempDirectory();
        const missing = path.join(projectRoot, "missing");

        expect(yield* matchesRepositoryIdentity(projectRoot, missing)).toBe(false);
        expect(yield* matchesRepositoryIdentity(missing, projectRoot)).toBe(false);
      }),
    ),
  );
});
