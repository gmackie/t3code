import {
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { it } from "@effect/vitest";
import { describe, expect } from "vite-plus/test";

import { makeExternalThreadImportService } from "./ExternalThreadImportService.ts";
import { ThreadImportLoadError, type ThreadImportSource } from "./ThreadImportSource.ts";

const environmentId = EnvironmentId.make("env-local");
const projectId = ProjectId.make("project-1");
const provider = {
  instanceId: ProviderInstanceId.make("claude-work"),
  driver: ProviderDriverKind.make("claudeAgent"),
};

describe("ExternalThreadImportService", () => {
  it.effect("discovers provider pages, signs opaque identities, and marks existing imports", () =>
    Effect.gen(function* () {
      let loadCalls = 0;
      const source: ThreadImportSource = {
        provider,
        discover: () =>
          Effect.succeed({
            candidates: [
              {
                provider,
                nativeThreadId: "native-1",
                recordedCwd: "/work/project",
                metadata: { title: "Prior work", updatedAt: 1_722_000_000_000 },
              },
            ],
            nextCursor: { offset: 1 },
          }),
        load: () => {
          loadCalls += 1;
          return Effect.die("discovery must not load history");
        },
      };
      const service = makeExternalThreadImportService({
        getEnvironmentId: Effect.succeed(environmentId),
        getProjectRoot: () => Effect.succeed("/work/project"),
        listSources: Effect.succeed([source]),
        issueToken: (identity) =>
          Effect.succeed({ token: `signed:${identity.nativeThreadId}` as never }),
        verifyToken: () => Effect.die("not used"),
        findImportedThread: () => Effect.succeed(ThreadId.make("thread-existing")),
        dispatchImport: () => Effect.die("not used"),
        randomId: Effect.succeed("unused"),
        now: Effect.succeed(1_722_000_000_000),
        matchesProject: () => Effect.succeed(true),
      });

      const result = yield* service.discover({ environmentId, projectId, limit: 25 });

      expect(loadCalls).toBe(0);
      expect(result.providerResults).toEqual([
        {
          _tag: "Success",
          provider,
          candidates: [
            expect.objectContaining({
              token: "signed:native-1",
              nativeThreadId: "native-1",
              title: "Prior work",
              status: { _tag: "AlreadyImported", threadId: "thread-existing" },
            }),
          ],
        },
      ]);
      expect(result.nextCursor).toBeDefined();
    }),
  );

  it.effect("loads selected histories independently and preserves per-item failures", () =>
    Effect.gen(function* () {
      const loadedNativeIds: Array<string> = [];
      const source: ThreadImportSource = {
        provider,
        discover: () => Effect.die("not used"),
        load: ({ nativeThreadId }) => {
          loadedNativeIds.push(nativeThreadId);
          return nativeThreadId === "bad"
            ? Effect.fail(
                new ThreadImportLoadError({
                  provider,
                  nativeThreadId,
                  code: "history_unreadable",
                  retryable: false,
                }),
              )
            : Effect.succeed({
                provider,
                nativeThreadId,
                recordedCwd: "/work/project",
                metadata: { updatedAt: 1_722_000_000_000 },
                normalizedHistory: [],
                provenance: { modelLabel: "claude-sonnet", sourceFormat: "jsonl" },
                decoderVersion: "claude-v1",
              });
        },
      };
      let nextId = 0;
      const service = makeExternalThreadImportService({
        getEnvironmentId: Effect.succeed(environmentId),
        getProjectRoot: () => Effect.succeed("/work/project"),
        listSources: Effect.succeed([source]),
        issueToken: () => Effect.die("not used"),
        verifyToken: (token) =>
          Effect.succeed({
            environmentId,
            projectId,
            provider,
            nativeThreadId: String(token).replace("token:", ""),
          }),
        findImportedThread: () => Effect.succeed(undefined),
        dispatchImport: ({ threadId }) => Effect.succeed(threadId),
        randomId: Effect.sync(() => String(++nextId)),
        now: Effect.succeed(1_722_000_000_000),
        matchesProject: () => Effect.succeed(true),
      });

      const result = yield* service.importSelected({
        environmentId,
        projectId,
        tokens: ["token:good" as never, "token:bad" as never],
      });

      expect(loadedNativeIds).toEqual(["good", "bad"]);
      expect(result.outcomes).toEqual([
        { _tag: "Imported", token: "token:good", threadId: "import-1" },
        expect.objectContaining({ _tag: "Failed", token: "token:bad", code: "history_unreadable" }),
      ]);
    }),
  );

  it.effect("resolves a real provider model instead of fabricating a default slug", () =>
    Effect.gen(function* () {
      let dispatchedModel: string | undefined;
      const source: ThreadImportSource = {
        provider,
        discover: () => Effect.die("not used"),
        load: ({ nativeThreadId }) =>
          Effect.succeed({
            provider,
            nativeThreadId,
            recordedCwd: "/work/project",
            metadata: { updatedAt: 1_722_000_000_000 },
            normalizedHistory: [],
            provenance: { sourceFormat: "jsonl" },
            decoderVersion: "claude-v1",
          }),
      };
      const service = makeExternalThreadImportService({
        getEnvironmentId: Effect.succeed(environmentId),
        getProjectRoot: () => Effect.succeed("/work/project"),
        listSources: Effect.succeed([source]),
        issueToken: () => Effect.die("not used"),
        verifyToken: () =>
          Effect.succeed({ environmentId, projectId, provider, nativeThreadId: "native" }),
        findImportedThread: () => Effect.succeed(undefined),
        resolveModelSelection: () =>
          Effect.succeed({ instanceId: provider.instanceId, model: "claude-sonnet-4-6" }),
        dispatchImport: ({ modelSelection, threadId }) => {
          dispatchedModel = modelSelection.model;
          return Effect.succeed(threadId);
        },
        randomId: Effect.succeed("id"),
        now: Effect.succeed(1_722_000_000_000),
        matchesProject: () => Effect.succeed(true),
      });

      yield* service.importSelected({ environmentId, projectId, tokens: ["token" as never] });
      expect(dispatchedModel).toBe("claude-sonnet-4-6");
      expect(dispatchedModel).not.toBe("default");
    }),
  );

  it.effect("does not restart exhausted providers on later aggregate pages", () =>
    Effect.gen(function* () {
      let exhaustedCalls = 0;
      let continuingCalls = 0;
      const exhausted: ThreadImportSource = {
        provider,
        discover: () => {
          exhaustedCalls += 1;
          return Effect.succeed({ candidates: [] });
        },
        load: () => Effect.die("not used"),
      };
      const codexProvider = {
        instanceId: ProviderInstanceId.make("codex"),
        driver: ProviderDriverKind.make("codex"),
      };
      const continuing: ThreadImportSource = {
        provider: codexProvider,
        discover: () => {
          continuingCalls += 1;
          return Effect.succeed({
            candidates: [],
            ...(continuingCalls === 1 ? { nextCursor: "next" } : {}),
          });
        },
        load: () => Effect.die("not used"),
      };
      const service = makeExternalThreadImportService({
        getEnvironmentId: Effect.succeed(environmentId),
        getProjectRoot: () => Effect.succeed("/work/project"),
        listSources: Effect.succeed([exhausted, continuing]),
        issueToken: () => Effect.die("not used"),
        verifyToken: () => Effect.die("not used"),
        findImportedThread: () => Effect.succeed(undefined),
        dispatchImport: () => Effect.die("not used"),
        randomId: Effect.succeed("unused"),
        now: Effect.succeed(0),
        matchesProject: () => Effect.succeed(true),
      });

      const first = yield* service.discover({ environmentId, projectId, limit: 10 });
      yield* service.discover({
        environmentId,
        projectId,
        limit: 10,
        cursor: first.nextCursor!,
      });

      expect(exhaustedCalls).toBe(1);
      expect(continuingCalls).toBe(2);
    }),
  );

  it.effect("shares one aggregate page budget fairly across providers", () =>
    Effect.gen(function* () {
      const requestedLimits: number[] = [];
      const sources = [
        provider,
        {
          instanceId: ProviderInstanceId.make("codex"),
          driver: ProviderDriverKind.make("codex"),
        },
      ].map(
        (sourceProvider): ThreadImportSource => ({
          provider: sourceProvider,
          discover: ({ limit }) => {
            requestedLimits.push(limit);
            return Effect.succeed({
              candidates: Array.from({ length: limit }, (_, index) => ({
                provider: sourceProvider,
                nativeThreadId: `${sourceProvider.instanceId}-${index}`,
                recordedCwd: "/work/project",
                metadata: { updatedAt: 1_722_000_000_000 },
              })),
              nextCursor: { offset: limit },
            });
          },
          load: () => Effect.die("not used"),
        }),
      );
      const service = makeExternalThreadImportService({
        getEnvironmentId: Effect.succeed(environmentId),
        getProjectRoot: () => Effect.succeed("/work/project"),
        listSources: Effect.succeed(sources),
        issueToken: (identity) => Effect.succeed({ token: identity.nativeThreadId as never }),
        verifyToken: () => Effect.die("not used"),
        findImportedThread: () => Effect.succeed(undefined),
        dispatchImport: () => Effect.die("not used"),
        randomId: Effect.succeed("page"),
        now: Effect.succeed(0),
        matchesProject: () => Effect.succeed(true),
      });

      const result = yield* service.discover({ environmentId, projectId, limit: 3 });
      const count = result.providerResults.reduce(
        (total, item) => total + (item._tag === "Success" ? item.candidates.length : 0),
        0,
      );
      expect(requestedLimits).toEqual([2, 1]);
      expect(count).toBe(3);
    }),
  );

  it.effect("filters candidates that do not belong to the selected project before signing", () =>
    Effect.gen(function* () {
      const source: ThreadImportSource = {
        provider,
        discover: () =>
          Effect.succeed({
            candidates: [
              {
                provider,
                nativeThreadId: "matching",
                recordedCwd: "/work/project",
                metadata: { updatedAt: 1_722_000_000_000 },
              },
              {
                provider,
                nativeThreadId: "other",
                recordedCwd: "/work/other",
                metadata: { updatedAt: 1_722_000_000_000 },
              },
            ],
          }),
        load: () => Effect.die("not used"),
      };
      const signed: Array<string> = [];
      const service = makeExternalThreadImportService({
        getEnvironmentId: Effect.succeed(environmentId),
        getProjectRoot: () => Effect.succeed("/work/project"),
        listSources: Effect.succeed([source]),
        issueToken: (identity) => {
          signed.push(identity.nativeThreadId);
          return Effect.succeed({ token: `signed:${identity.nativeThreadId}` as never });
        },
        verifyToken: () => Effect.die("not used"),
        findImportedThread: () => Effect.succeed(undefined),
        dispatchImport: () => Effect.die("not used"),
        randomId: Effect.succeed("unused"),
        now: Effect.succeed(0),
        matchesProject: (_root, candidateCwd) => Effect.succeed(candidateCwd === "/work/project"),
      });

      const result = yield* service.discover({ environmentId, projectId, limit: 10 });

      expect(signed).toEqual(["matching"]);
      expect(result.providerResults[0]).toMatchObject({
        _tag: "Success",
        candidates: [{ nativeThreadId: "matching" }],
      });
    }),
  );

  it.effect("prepares repository identity once for every candidate in a discovery request", () =>
    Effect.gen(function* () {
      let preparations = 0;
      let matches = 0;
      const source: ThreadImportSource = {
        provider,
        discover: () =>
          Effect.succeed({
            candidates: ["one", "two"].map((nativeThreadId) => ({
              provider,
              nativeThreadId,
              recordedCwd: `/work/project/${nativeThreadId}`,
              metadata: { updatedAt: 1_722_000_000_000 },
            })),
          }),
        load: () => Effect.die("not used"),
      };
      const service = makeExternalThreadImportService({
        getEnvironmentId: Effect.succeed(environmentId),
        getProjectRoot: () => Effect.succeed("/work/project"),
        listSources: Effect.succeed([source]),
        issueToken: (identity) => Effect.succeed({ token: identity.nativeThreadId as never }),
        verifyToken: () => Effect.die("not used"),
        findImportedThread: () => Effect.succeed(undefined),
        dispatchImport: () => Effect.die("not used"),
        randomId: Effect.succeed("unused"),
        now: Effect.succeed(0),
        matchesProject: () => Effect.die("prepared matcher must be reused"),
        prepareProjectMatcher: () => {
          preparations += 1;
          return Effect.succeed({
            matches: () => {
              matches += 1;
              return Effect.succeed(true);
            },
          });
        },
      });

      yield* service.discover({ environmentId, projectId, limit: 10 });
      expect(preparations).toBe(1);
      expect(matches).toBe(2);
    }),
  );

  it.effect("matches candidates concurrently so a large page does not block discovery", () =>
    Effect.gen(function* () {
      let active = 0;
      let peak = 0;
      const source: ThreadImportSource = {
        provider,
        discover: () =>
          Effect.succeed({
            candidates: Array.from({ length: 8 }, (_, index) => ({
              provider,
              nativeThreadId: `thread-${index}`,
              recordedCwd: `/work/project/${index}`,
              metadata: { updatedAt: 1_722_000_000_000 + index },
            })),
          }),
        load: () => Effect.die("not used"),
      };
      const service = makeExternalThreadImportService({
        getEnvironmentId: Effect.succeed(environmentId),
        getProjectRoot: () => Effect.succeed("/work/project"),
        listSources: Effect.succeed([source]),
        issueToken: (identity) => Effect.succeed({ token: identity.nativeThreadId as never }),
        verifyToken: () => Effect.die("not used"),
        findImportedThread: () => Effect.succeed(undefined),
        dispatchImport: () => Effect.die("not used"),
        randomId: Effect.succeed("unused"),
        now: Effect.succeed(0),
        matchesProject: () => Effect.die("prepared matcher must be reused"),
        prepareProjectMatcher: () =>
          Effect.succeed({
            matches: () =>
              Effect.acquireUseRelease(
                Effect.sync(() => {
                  active += 1;
                  peak = Math.max(peak, active);
                }),
                () => Effect.sleep("10 millis").pipe(Effect.as(true)),
                () =>
                  Effect.sync(() => {
                    active -= 1;
                  }),
              ),
          }),
      });

      const discovery = yield* service
        .discover({ environmentId, projectId, limit: 8 })
        .pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      expect(peak).toBeGreaterThan(1);
      yield* TestClock.adjust("10 millis");
      yield* Fiber.join(discovery);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("rejects a discovery cursor outside the environment and project that issued it", () =>
    Effect.gen(function* () {
      const source: ThreadImportSource = {
        provider,
        discover: () => Effect.succeed({ candidates: [], nextCursor: { offset: 1 } }),
        load: () => Effect.die("not used"),
      };
      const service = makeExternalThreadImportService({
        getEnvironmentId: Effect.succeed(environmentId),
        getProjectRoot: () => Effect.succeed("/work/project"),
        listSources: Effect.succeed([source]),
        issueToken: () => Effect.die("not used"),
        verifyToken: () => Effect.die("not used"),
        findImportedThread: () => Effect.succeed(undefined),
        dispatchImport: () => Effect.die("not used"),
        randomId: Effect.succeed("scope-token"),
        now: Effect.succeed(0),
        matchesProject: () => Effect.succeed(true),
      });
      const first = yield* service.discover({ environmentId, projectId, limit: 10 });

      const exit = yield* Effect.exit(
        service.discover({
          environmentId,
          projectId: ProjectId.make("project-2"),
          limit: 10,
          cursor: first.nextCursor!,
        }),
      );

      expect(exit._tag).toBe("Failure");
    }),
  );
});
