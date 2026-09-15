import {
  ProjectSessionImportRequestError,
  type EnvironmentId,
  type ProjectSessionImportScanCursor,
  type ProjectSessionImportScanInput,
  type ProjectSessionImportScanResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { expandHomePath } from "../pathExpansion.ts";
import {
  createRepositoryScan,
  type RepositoryScanPage,
  type RepositoryScanState,
  scanRepositoryPage,
} from "./RepositoryScanner.ts";

interface Dependencies {
  readonly getEnvironmentId: Effect.Effect<EnvironmentId, ProjectSessionImportRequestError>;
  readonly randomId: Effect.Effect<string, ProjectSessionImportRequestError>;
  readonly createScan: (
    root: string,
  ) => Effect.Effect<RepositoryScanState, ProjectSessionImportRequestError>;
  readonly scanPage: (
    state: RepositoryScanState,
    options: { readonly repositoryLimit: number; readonly directoryLimit: number },
  ) => Effect.Effect<RepositoryScanPage, ProjectSessionImportRequestError>;
}

interface CursorEntry {
  readonly environmentId: EnvironmentId;
  readonly requestedRoot: string;
  readonly state: RepositoryScanState;
}

const requestError = (code: string, message: string, retryable?: boolean) =>
  new ProjectSessionImportRequestError({
    code,
    message,
    ...(retryable === undefined ? {} : { retryable }),
  });

export const makeProjectSessionImportService = (dependencies: Dependencies) => {
  const cursors = new Map<string, CursorEntry>();

  const scan = Effect.fn("ProjectSessionImportService.scan")(function* (
    input: ProjectSessionImportScanInput,
  ) {
    const environmentId = yield* dependencies.getEnvironmentId.pipe(
      Effect.mapError(() =>
        requestError("environment_unavailable", "The local environment is unavailable.", true),
      ),
    );
    if (environmentId !== input.environmentId) {
      return yield* requestError("environment_mismatch", "The requested environment is not local.");
    }

    let state: RepositoryScanState;
    if (input.cursor === undefined) {
      state = yield* dependencies
        .createScan(input.root)
        .pipe(
          Effect.mapError(() =>
            requestError("scan_root_unavailable", "The selected scan root is unavailable."),
          ),
        );
    } else {
      const entry = cursors.get(input.cursor);
      if (
        entry === undefined ||
        entry.environmentId !== input.environmentId ||
        entry.requestedRoot !== input.root
      ) {
        return yield* requestError("invalid_cursor", "The repository scan cursor is invalid.");
      }
      cursors.delete(input.cursor);
      state = entry.state;
    }

    const page = yield* dependencies
      .scanPage(state, { repositoryLimit: input.limit, directoryLimit: 100 })
      .pipe(
        Effect.mapError(() => requestError("scan_failed", "Repository discovery failed.", true)),
      );
    let nextCursor: ProjectSessionImportScanCursor | undefined;
    if (!page.done) {
      nextCursor = `scan:${yield* dependencies.randomId.pipe(
        Effect.mapError(() =>
          requestError("cursor_failed", "Could not continue repository discovery.", true),
        ),
      )}` as ProjectSessionImportScanCursor;
      if (cursors.size >= 1_024) cursors.delete(cursors.keys().next().value!);
      cursors.set(nextCursor, {
        environmentId: input.environmentId,
        requestedRoot: input.root,
        state: page.state,
      });
    }
    return {
      repositories: page.repositories,
      scannedDirectoryCount: page.state.scannedDirectoryCount,
      ...(nextCursor === undefined ? {} : { nextCursor }),
    } satisfies ProjectSessionImportScanResult;
  });

  return { scan };
};

export class ProjectSessionImportService extends Context.Service<
  ProjectSessionImportService,
  ReturnType<typeof makeProjectSessionImportService>
>()("t3/projectImport/ProjectSessionImportService") {}

const makeLive = Effect.gen(function* () {
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const crypto = yield* Crypto.Crypto;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const providePlatform = <A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>) =>
    effect.pipe(
      Effect.provideService(FileSystem.FileSystem, fileSystem),
      Effect.provideService(Path.Path, path),
    );
  return ProjectSessionImportService.of(
    makeProjectSessionImportService({
      getEnvironmentId: environment.getEnvironmentId.pipe(
        Effect.mapError(() =>
          requestError("environment_unavailable", "The local environment is unavailable.", true),
        ),
      ),
      randomId: crypto.randomUUIDv4.pipe(
        Effect.mapError(() =>
          requestError("cursor_failed", "Could not continue repository discovery.", true),
        ),
      ),
      createScan: (root) =>
        providePlatform(createRepositoryScan(expandHomePath(root))).pipe(
          Effect.mapError(() =>
            requestError("scan_root_unavailable", "The selected scan root is unavailable."),
          ),
        ),
      scanPage: (state, options) =>
        providePlatform(scanRepositoryPage(state, options)).pipe(
          Effect.mapError(() => requestError("scan_failed", "Repository discovery failed.", true)),
        ),
    }),
  );
});

export const layer = Layer.effect(ProjectSessionImportService, makeLive);
