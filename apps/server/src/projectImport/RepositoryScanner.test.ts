import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { createRepositoryScan, scanRepositoryPage } from "./RepositoryScanner.ts";

const makeRepository = Effect.fn("RepositoryScannerTest.makeRepository")(function* (root: string) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fileSystem.makeDirectory(path.join(root, ".git"), { recursive: true });
});

it.layer(NodeServices.layer)("RepositoryScanner", (it) => {
  it.effect("finds Git roots recursively while pruning dependencies and vendored references", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-project-import-" });
        yield* makeRepository(path.join(root, "alpha"));
        yield* makeRepository(path.join(root, "group", "beta"));
        yield* makeRepository(path.join(root, "node_modules", "dependency"));
        yield* makeRepository(path.join(root, ".repos", "vendored"));

        const result = yield* scanRepositoryPage(yield* createRepositoryScan(root), {
          repositoryLimit: 20,
          directoryLimit: 100,
        });
        const canonicalRoot = yield* fileSystem.realPath(root);

        expect(result.repositories).toEqual([
          { root: path.join(canonicalRoot, "alpha"), name: "alpha" },
          { root: path.join(canonicalRoot, "group", "beta"), name: "beta" },
        ]);
        expect(result.done).toBe(true);
      }),
    ),
  );

  it.effect("does not follow directory symlinks", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-project-import-" });
        const outside = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-import-outside-" });
        yield* makeRepository(path.join(outside, "secret"));
        yield* fileSystem.symlink(outside, path.join(root, "linked"));

        const result = yield* scanRepositoryPage(yield* createRepositoryScan(root), {
          repositoryLimit: 20,
          directoryLimit: 100,
        });
        expect(result.repositories).toEqual([]);
      }),
    ),
  );

  it.effect("returns bounded incremental pages", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-project-import-" });
        yield* makeRepository(path.join(root, "alpha"));
        yield* makeRepository(path.join(root, "beta"));

        const first = yield* scanRepositoryPage(yield* createRepositoryScan(root), {
          repositoryLimit: 1,
          directoryLimit: 100,
        });
        const second = yield* scanRepositoryPage(first.state, {
          repositoryLimit: 1,
          directoryLimit: 100,
        });

        expect(first.repositories).toHaveLength(1);
        expect(first.done).toBe(false);
        expect(second.repositories).toHaveLength(1);
        expect(second.done).toBe(true);
        expect(
          [first.repositories[0]?.root, second.repositories[0]?.root].map((value) =>
            path.basename(value!),
          ),
        ).toEqual(["alpha", "beta"]);
      }),
    ),
  );
});
