import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { makeProjectSessionImportService } from "./ProjectSessionImportService.ts";
import type { RepositoryScanState } from "./RepositoryScanner.ts";

const initialState: RepositoryScanState = {
  root: "/Volumes/dev",
  pendingDirectories: ["/Volumes/dev"],
  scannedDirectoryCount: 0,
};

it.effect("returns a continuation cursor and resumes the same scan", () =>
  Effect.gen(function* () {
    let calls = 0;
    const service = makeProjectSessionImportService({
      getEnvironmentId: Effect.succeed("local" as never),
      randomId: Effect.succeed("id"),
      createScan: () => Effect.succeed(initialState),
      scanPage: (state) => {
        calls += 1;
        return Effect.succeed({
          repositories: [{ root: `${state.root}/repo-${calls}`, name: `repo-${calls}` }],
          state: {
            ...state,
            scannedDirectoryCount: calls,
            pendingDirectories: calls === 1 ? ["next"] : [],
          },
          done: calls > 1,
        });
      },
    });

    const first = yield* service.scan({
      environmentId: "local" as never,
      root: "/Volumes/dev",
      limit: 1,
    });
    expect(first.nextCursor).toBe("scan:id");
    const second = yield* service.scan({
      environmentId: "local" as never,
      root: "/Volumes/dev",
      cursor: first.nextCursor!,
      limit: 1,
    });
    expect(second.repositories[0]?.name).toBe("repo-2");
    expect(second.nextCursor).toBeUndefined();
  }),
);

it.effect("rejects cursors outside their environment and root scope", () =>
  Effect.gen(function* () {
    const service = makeProjectSessionImportService({
      getEnvironmentId: Effect.succeed("local" as never),
      randomId: Effect.succeed("id"),
      createScan: () => Effect.succeed(initialState),
      scanPage: (state) =>
        Effect.succeed({
          repositories: [],
          state: { ...state, pendingDirectories: ["next"] },
          done: false,
        }),
    });
    const first = yield* service.scan({
      environmentId: "local" as never,
      root: "/Volumes/dev",
      limit: 1,
    });
    const failure = yield* Effect.flip(
      service.scan({
        environmentId: "local" as never,
        root: "/Volumes/other",
        cursor: first.nextCursor!,
        limit: 1,
      }),
    );
    expect(failure.code).toBe("invalid_cursor");
  }),
);
