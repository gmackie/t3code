import type { ProjectSessionImportRepository } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

export class RepositoryScanInputError extends Schema.TaggedErrorClass<RepositoryScanInputError>()(
  "RepositoryScanInputError",
  { message: Schema.String },
) {}

const PRUNED_DIRECTORY_NAMES = new Set([
  ".cache",
  ".git",
  ".next",
  ".repos",
  ".Trash",
  ".turbo",
  ".worktrees",
  "Application Support",
  "build",
  "coverage",
  "dist",
  "Library",
  "node_modules",
  "Pods",
  "target",
  "vendor",
]);

export interface RepositoryScanState {
  readonly root: string;
  readonly pendingDirectories: readonly string[];
  readonly scannedDirectoryCount: number;
}

export interface RepositoryScanPageOptions {
  readonly repositoryLimit: number;
  readonly directoryLimit: number;
}

export interface RepositoryScanPage {
  readonly repositories: readonly ProjectSessionImportRepository[];
  readonly state: RepositoryScanState;
  readonly done: boolean;
}

export const createRepositoryScan = Effect.fn("RepositoryScanner.createRepositoryScan")(function* (
  root: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const canonicalRoot = yield* fileSystem.realPath(root);
  const stats = yield* fileSystem.stat(canonicalRoot);
  if (stats.type !== "Directory") {
    return yield* new RepositoryScanInputError({
      message: `Scan root is not a directory: ${root}`,
    });
  }
  return {
    root: canonicalRoot,
    pendingDirectories: [canonicalRoot],
    scannedDirectoryCount: 0,
  } satisfies RepositoryScanState;
});

export const scanRepositoryPage = Effect.fn("RepositoryScanner.scanRepositoryPage")(function* (
  initialState: RepositoryScanState,
  options: RepositoryScanPageOptions,
) {
  if (options.repositoryLimit < 1 || options.directoryLimit < 1) {
    return yield* new RepositoryScanInputError({
      message: "Repository and directory scan limits must be positive.",
    });
  }

  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const pendingDirectories = [...initialState.pendingDirectories];
  const repositories: ProjectSessionImportRepository[] = [];
  let scannedThisPage = 0;

  while (
    pendingDirectories.length > 0 &&
    repositories.length < options.repositoryLimit &&
    scannedThisPage < options.directoryLimit
  ) {
    const directory = pendingDirectories.shift()!;
    scannedThisPage += 1;
    const entries = yield* fileSystem
      .readDirectory(directory)
      .pipe(Effect.orElseSucceed((): Array<string> => []));

    if (entries.includes(".git")) {
      repositories.push({ root: directory, name: path.basename(directory) });
      continue;
    }

    const childNames = [...entries]
      .filter((name) => !PRUNED_DIRECTORY_NAMES.has(name))
      .sort((left, right) => left.localeCompare(right));
    const childDirectories = yield* Effect.forEach(
      childNames,
      (name) =>
        Effect.gen(function* () {
          const child = path.join(directory, name);
          const isSymbolicLink = yield* fileSystem
            .readLink(child)
            .pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }));
          if (isSymbolicLink) return undefined;
          const isDirectory = yield* fileSystem.stat(child).pipe(
            Effect.match({
              onFailure: () => false,
              onSuccess: (info) => info.type === "Directory",
            }),
          );
          return isDirectory ? child : undefined;
        }),
      { concurrency: 16 },
    );
    pendingDirectories.push(
      ...childDirectories.filter((child): child is string => child !== undefined),
    );
  }

  const state = {
    root: initialState.root,
    pendingDirectories,
    scannedDirectoryCount: initialState.scannedDirectoryCount + scannedThisPage,
  } satisfies RepositoryScanState;
  return {
    repositories,
    state,
    done: pendingDirectories.length === 0,
  } satisfies RepositoryScanPage;
});
