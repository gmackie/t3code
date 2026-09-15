import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  CommandId,
  ExternalThreadImportRequestError,
  type EnvironmentId,
  type ExternalThreadImportBatchResult,
  type ExternalThreadImportCandidateToken,
  type ExternalThreadImportDiscoveryInput,
  type ExternalThreadImportDiscoveryResult,
  type ExternalThreadImportSelection,
  type ModelSelection,
  type ProjectId,
  type ProviderInstanceRef,
  type ThreadId,
  ThreadId as ThreadIdSchema,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProviderInstanceRegistry from "../provider/Services/ProviderInstanceRegistry.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as CandidateToken from "./ExternalThreadImportCandidateToken.ts";
import {
  prepareRepositoryIdentityMatcher,
  type RepositoryIdentityMatcher,
} from "./RepositoryIdentity.ts";

import type {
  BoundedThreadImportJson,
  LoadedThreadImportSnapshot,
  ThreadImportSource,
} from "./ThreadImportSource.ts";

export interface ExternalThreadImportIdentity {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly provider: ProviderInstanceRef;
  readonly nativeThreadId: string;
}

interface Dependencies {
  readonly getEnvironmentId: Effect.Effect<EnvironmentId, ExternalThreadImportRequestError>;
  readonly getProjectRoot: (
    projectId: ProjectId,
  ) => Effect.Effect<string, ExternalThreadImportRequestError>;
  readonly listSources: Effect.Effect<
    ReadonlyArray<ThreadImportSource>,
    ExternalThreadImportRequestError
  >;
  readonly issueToken: (
    identity: ExternalThreadImportIdentity,
  ) => Effect.Effect<
    { readonly token: ExternalThreadImportCandidateToken },
    ExternalThreadImportRequestError
  >;
  readonly verifyToken: (
    token: ExternalThreadImportCandidateToken,
    scope: { readonly environmentId: EnvironmentId; readonly projectId: ProjectId },
  ) => Effect.Effect<ExternalThreadImportIdentity, ExternalThreadImportRequestError>;
  readonly findImportedThread: (
    identity: ExternalThreadImportIdentity,
  ) => Effect.Effect<ThreadId | undefined, ExternalThreadImportRequestError>;
  readonly resolveModelSelection?: (
    identity: ExternalThreadImportIdentity,
    snapshot: LoadedThreadImportSnapshot,
  ) => Effect.Effect<ModelSelection, ExternalThreadImportRequestError>;
  readonly dispatchImport: (input: {
    readonly identity: ExternalThreadImportIdentity;
    readonly projectRoot: string;
    readonly snapshot: LoadedThreadImportSnapshot;
    readonly modelSelection: ModelSelection;
    readonly threadId: ThreadId;
    readonly commandId: string;
    readonly now: number;
  }) => Effect.Effect<ThreadId, ExternalThreadImportRequestError>;
  readonly randomId: Effect.Effect<string, ExternalThreadImportRequestError>;
  readonly now: Effect.Effect<number, ExternalThreadImportRequestError>;
  readonly matchesProject: (
    projectRoot: string,
    candidateCwd: string,
  ) => Effect.Effect<boolean, ExternalThreadImportRequestError>;
  readonly prepareProjectMatcher?: (
    projectRoot: string,
  ) => Effect.Effect<RepositoryIdentityMatcher, ExternalThreadImportRequestError>;
}

const requestError = (code: string, message: string, retryable?: boolean) =>
  new ExternalThreadImportRequestError({
    code,
    message,
    ...(retryable === undefined ? {} : { retryable }),
  });

const sourceKey = (provider: ProviderInstanceRef) => `${provider.driver}:${provider.instanceId}`;

type CursorState = Readonly<Record<string, BoundedThreadImportJson>>;
interface CursorEntry {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly state: CursorState;
}
const RETRY_CURSOR = { retry: true } as const;

const iso = (milliseconds: number) => DateTime.formatIso(DateTime.makeUnsafe(milliseconds));

export const makeExternalThreadImportService = (dependencies: Dependencies) => {
  const cursors = new Map<string, CursorEntry>();
  const resolveScope = (input: {
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
  }) =>
    Effect.gen(function* () {
      const localEnvironmentId = yield* dependencies.getEnvironmentId;
      if (localEnvironmentId !== input.environmentId) {
        return yield* requestError(
          "environment_mismatch",
          "The requested environment is not local.",
        );
      }
      const projectRoot = yield* dependencies.getProjectRoot(input.projectId);
      return { projectRoot };
    });

  const discover = (input: ExternalThreadImportDiscoveryInput) =>
    Effect.gen(function* () {
      const { projectRoot } = yield* resolveScope(input);
      const projectMatcher = dependencies.prepareProjectMatcher
        ? yield* dependencies.prepareProjectMatcher(projectRoot)
        : {
            matches: (candidateCwd: string) =>
              dependencies.matchesProject(projectRoot, candidateCwd),
          };
      const cursorEntry = input.cursor === undefined ? undefined : cursors.get(input.cursor);
      if (
        input.cursor !== undefined &&
        (cursorEntry === undefined ||
          cursorEntry.environmentId !== input.environmentId ||
          cursorEntry.projectId !== input.projectId)
      ) {
        return yield* requestError("invalid_cursor", "The discovery cursor is invalid.");
      }
      const cursorState = cursorEntry?.state ?? {};
      const sources = yield* dependencies.listSources;
      const nextState: Record<string, BoundedThreadImportJson> = {};
      let remainingBudget = input.limit;
      let remainingActiveSources = sources.filter(
        (source) => cursorState[sourceKey(source.provider)] !== null,
      ).length;
      const providerResults = yield* Effect.forEach(sources, (source) => {
        const providerCursor = cursorState[sourceKey(source.provider)];
        if (providerCursor === null) {
          nextState[sourceKey(source.provider)] = null;
          return Effect.succeed({
            _tag: "Success" as const,
            provider: source.provider,
            candidates: [],
          });
        }
        const providerLimit = Math.max(
          1,
          Math.ceil(remainingBudget / Math.max(1, remainingActiveSources)),
        );
        remainingActiveSources -= 1;
        return source
          .discover({
            environmentId: input.environmentId,
            projectId: input.projectId,
            projectRoot,
            ...(providerCursor === undefined || providerCursor === RETRY_CURSOR
              ? {}
              : { cursor: providerCursor }),
            limit: providerLimit,
          })
          .pipe(
            Effect.flatMap((page) =>
              Effect.forEach(
                page.candidates,
                (candidate) => {
                  const identity = {
                    environmentId: input.environmentId,
                    projectId: input.projectId,
                    provider: candidate.provider,
                    nativeThreadId: candidate.nativeThreadId,
                  } satisfies ExternalThreadImportIdentity;
                  return projectMatcher.matches(candidate.recordedCwd).pipe(
                    Effect.flatMap((matches) =>
                      matches
                        ? Effect.all({
                            issued: dependencies.issueToken(identity),
                            importedThreadId: dependencies.findImportedThread(identity),
                          }).pipe(
                            Effect.map(({ issued, importedThreadId }) => ({
                              token: issued.token,
                              provider: candidate.provider,
                              nativeThreadId: candidate.nativeThreadId,
                              ...(candidate.metadata.title
                                ? { title: candidate.metadata.title }
                                : {}),
                              ...(candidate.metadata.firstPromptPreview
                                ? { firstPromptPreview: candidate.metadata.firstPromptPreview }
                                : {}),
                              originalCwd: candidate.recordedCwd,
                              ...(candidate.metadata.createdAt === undefined
                                ? {}
                                : { createdAt: iso(candidate.metadata.createdAt) }),
                              updatedAt: iso(candidate.metadata.updatedAt),
                              ...(candidate.metadata.turnCount === undefined
                                ? {}
                                : { turnCount: candidate.metadata.turnCount }),
                              ...(candidate.metadata.messageCount === undefined
                                ? {}
                                : { messageCount: candidate.metadata.messageCount }),
                              ...(candidate.metadata.toolCallCount === undefined
                                ? {}
                                : { toolCallCount: candidate.metadata.toolCallCount }),
                              status:
                                importedThreadId === undefined
                                  ? ({ _tag: "Available" } as const)
                                  : ({
                                      _tag: "AlreadyImported",
                                      threadId: importedThreadId,
                                    } as const),
                            })),
                          )
                        : Effect.succeed(undefined),
                    ),
                  );
                },
                { concurrency: 16 },
              ).pipe(
                Effect.map((candidates) => ({
                  page,
                  candidates: candidates.filter((candidate) => candidate !== undefined),
                })),
              ),
            ),
            Effect.map(({ page, candidates }) => {
              remainingBudget = Math.max(0, remainingBudget - candidates.length);
              nextState[sourceKey(source.provider)] = page.nextCursor ?? null;
              return { _tag: "Success" as const, provider: source.provider, candidates };
            }),
            Effect.catch((error) =>
              Effect.sync(() => {
                nextState[sourceKey(source.provider)] = providerCursor ?? RETRY_CURSOR;
                return {
                  _tag: "Failure" as const,
                  provider: source.provider,
                  code:
                    "code" in Object(error)
                      ? String((error as { code: unknown }).code)
                      : "discovery_failed",
                  message: `Could not discover ${source.provider.driver} threads.`,
                  retryable:
                    "retryable" in Object(error)
                      ? Boolean((error as { retryable: unknown }).retryable)
                      : true,
                };
              }),
            ),
          );
      });
      const hasNext = !Object.values(nextState).every((value) => value === null);
      const nextCursor = hasNext
        ? (`cursor:${yield* dependencies.randomId}` as NonNullable<
            ExternalThreadImportDiscoveryResult["nextCursor"]
          >)
        : undefined;
      if (nextCursor !== undefined) {
        if (cursors.size >= 1_024) cursors.delete(cursors.keys().next().value!);
        cursors.set(nextCursor, {
          environmentId: input.environmentId,
          projectId: input.projectId,
          state: nextState,
        });
      }
      return {
        providerResults,
        ...(nextCursor === undefined ? {} : { nextCursor }),
      } satisfies ExternalThreadImportDiscoveryResult;
    });

  const importSelected = (input: ExternalThreadImportSelection) =>
    Effect.gen(function* () {
      const { projectRoot } = yield* resolveScope(input);
      const projectMatcher = dependencies.prepareProjectMatcher
        ? yield* dependencies.prepareProjectMatcher(projectRoot)
        : {
            matches: (candidateCwd: string) =>
              dependencies.matchesProject(projectRoot, candidateCwd),
          };
      const sources = yield* dependencies.listSources;
      const byProvider = new Map(sources.map((source) => [sourceKey(source.provider), source]));
      const outcomes = yield* Effect.forEach(input.tokens, (token) =>
        Effect.gen(function* () {
          const identity = yield* dependencies.verifyToken(token, input);
          const existing = yield* dependencies.findImportedThread(identity);
          if (existing !== undefined)
            return { _tag: "AlreadyImported" as const, token, threadId: existing };
          const source = byProvider.get(sourceKey(identity.provider));
          if (source === undefined)
            return yield* requestError(
              "provider_unavailable",
              "The provider is unavailable.",
              true,
            );
          const snapshot = yield* source.load({
            environmentId: input.environmentId,
            projectId: input.projectId,
            projectRoot,
            nativeThreadId: identity.nativeThreadId,
          });
          if (!(yield* projectMatcher.matches(snapshot.recordedCwd))) {
            return yield* requestError(
              "project_mismatch",
              "The native thread no longer belongs to this project.",
            );
          }
          const [threadSeed, commandSeed, now] = yield* Effect.all([
            dependencies.randomId,
            dependencies.randomId,
            dependencies.now,
          ]);
          let modelSelection: ModelSelection;
          if (snapshot.provenance.modelLabel) {
            modelSelection = {
              instanceId: identity.provider.instanceId,
              model: snapshot.provenance.modelLabel,
            };
          } else if (dependencies.resolveModelSelection) {
            modelSelection = yield* dependencies.resolveModelSelection(identity, snapshot);
          } else {
            return yield* requestError(
              "provider_model_unavailable",
              "A configured model could not be resolved for this provider.",
              true,
            );
          }
          const threadId = `import-${threadSeed}` as ThreadId;
          const importedThreadId = yield* dependencies.dispatchImport({
            identity,
            projectRoot,
            snapshot,
            modelSelection,
            threadId,
            commandId: `import-${commandSeed}`,
            now,
          });
          return { _tag: "Imported" as const, token, threadId: importedThreadId };
        }).pipe(
          Effect.catch((error) =>
            Effect.succeed({
              _tag: "Failed" as const,
              token,
              code:
                "code" in Object(error)
                  ? String((error as { code: unknown }).code)
                  : "import_failed",
              message:
                "message" in Object(error) &&
                typeof (error as { message?: unknown }).message === "string" &&
                (error as { message: string }).message.trim().length > 0
                  ? (error as { message: string }).message
                  : "The thread could not be imported.",
              retryable:
                "retryable" in Object(error)
                  ? Boolean((error as { retryable: unknown }).retryable)
                  : undefined,
            }),
          ),
        ),
      );
      return { outcomes } satisfies ExternalThreadImportBatchResult;
    });

  return {
    discover,
    importSelected,
    defaults: {
      runtimeMode: DEFAULT_RUNTIME_MODE,
      interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    },
  };
};

export interface ExternalThreadImportServiceShape {
  readonly discover: ReturnType<typeof makeExternalThreadImportService>["discover"];
  readonly importSelected: ReturnType<typeof makeExternalThreadImportService>["importSelected"];
}

export class ExternalThreadImportService extends Context.Service<
  ExternalThreadImportService,
  ExternalThreadImportServiceShape
>()("t3/threadImport/ExternalThreadImportService") {}

export const makeLive = Effect.gen(function* () {
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const projects = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const instances = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const tokenCodec = yield* CandidateToken.ExternalThreadImportCandidateTokenCodec;
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const sql = yield* SqlClient.SqlClient;
  const crypto = yield* Crypto.Crypto;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const vcsProcess = yield* VcsProcess.VcsProcess;

  const listSources = instances.listInstances.pipe(
    Effect.map((values) =>
      values.flatMap((instance) =>
        instance.threadImportSource ? [instance.threadImportSource] : [],
      ),
    ),
  );

  const service = makeExternalThreadImportService({
    getEnvironmentId: environment.getEnvironmentId,
    getProjectRoot: (projectId) =>
      projects.getProjectShellById(projectId).pipe(
        Effect.mapError(() =>
          requestError("project_lookup_failed", "The project could not be loaded.", true),
        ),
        Effect.flatMap((project) =>
          Option.isSome(project)
            ? Effect.succeed(project.value.workspaceRoot)
            : Effect.fail(requestError("project_not_found", `Project ${projectId} was not found.`)),
        ),
      ),
    listSources,
    issueToken: (identity) =>
      tokenCodec
        .issue(identity)
        .pipe(
          Effect.mapError(() =>
            requestError("token_issue_failed", "The import token could not be issued.", true),
          ),
        ),
    verifyToken: (token, scope) =>
      listSources.pipe(
        Effect.flatMap((sources) =>
          sources.length === 0
            ? Effect.fail(
                requestError("provider_unavailable", "The provider is unavailable.", true),
              )
            : Effect.firstSuccessOf(
                sources.map((source) =>
                  tokenCodec
                    .verify(token, { ...scope, provider: source.provider })
                    .pipe(
                      Effect.mapError(() =>
                        requestError("invalid_token", "The import token is invalid."),
                      ),
                    ),
                ),
              ),
        ),
      ),
    findImportedThread: (identity) =>
      instances.getInstance(identity.provider.instanceId).pipe(
        Effect.flatMap((instance) =>
          instance === undefined
            ? Effect.succeed([])
            : sql<{ readonly threadId: string }>`
        SELECT thread_id AS "threadId"
        FROM projection_external_thread_imports
        WHERE environment_id = ${identity.environmentId}
          AND continuation_group = ${instance.continuationIdentity.continuationKey}
          AND provider_instance_id = ${identity.provider.instanceId}
          AND provider_driver = ${identity.provider.driver}
          AND native_thread_id = ${identity.nativeThreadId}
        LIMIT 1
      `,
        ),
        Effect.map((rows) =>
          rows[0] === undefined ? undefined : ThreadIdSchema.make(rows[0].threadId),
        ),
        Effect.mapError(() =>
          requestError("import_lookup_failed", "Existing imports could not be checked.", true),
        ),
      ),
    resolveModelSelection: (identity) =>
      instances.getInstance(identity.provider.instanceId).pipe(
        Effect.flatMap((instance) =>
          Effect.gen(function* () {
            if (instance === undefined || instance.driverKind !== identity.provider.driver) {
              return yield* requestError(
                "provider_model_unavailable",
                "A configured model could not be resolved for this provider.",
                true,
              );
            }
            const providerSnapshot = yield* instance.snapshot.getSnapshot;
            const model =
              providerSnapshot.models.find((candidate) => !candidate.isCustom)?.slug ??
              providerSnapshot.models[0]?.slug;
            if (!model) {
              return yield* requestError(
                "provider_model_unavailable",
                "A configured model could not be resolved for this provider.",
                true,
              );
            }
            return { instanceId: identity.provider.instanceId, model };
          }),
        ),
      ),
    dispatchImport: (input) =>
      Effect.gen(function* () {
        const instance = yield* instances.getInstance(input.identity.provider.instanceId);
        if (instance === undefined || instance.driverKind !== input.identity.provider.driver) {
          return yield* requestError(
            "provider_unavailable",
            "The provider instance is unavailable.",
            true,
          );
        }
        const createdAt = iso(input.snapshot.metadata.createdAt ?? input.now);
        const updatedAt = iso(input.snapshot.metadata.updatedAt);
        const importedAt = iso(input.now);
        const result = yield* engine
          .dispatch({
            type: "thread.import",
            commandId: CommandId.make(input.commandId),
            threadId: input.threadId,
            projectId: input.identity.projectId,
            environmentId: input.identity.environmentId,
            title:
              input.snapshot.metadata.title ??
              input.snapshot.metadata.firstPromptPreview ??
              "Imported thread",
            modelSelection: input.modelSelection,
            runtimeMode: DEFAULT_RUNTIME_MODE,
            interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
            branch: null,
            worktreePath: null,
            originalCwd: input.snapshot.recordedCwd,
            normalizedHistory: input.snapshot.normalizedHistory,
            provenance: {
              provider: input.identity.provider,
              nativeThreadId: input.identity.nativeThreadId,
              continuationGroup: instance.continuationIdentity.continuationKey,
              originalCwd: input.snapshot.recordedCwd,
              ...(input.snapshot.resumeCursor === undefined
                ? {}
                : { resumeCursor: input.snapshot.resumeCursor }),
              decoderVersion: input.snapshot.decoderVersion,
              importedAt,
            },
            createdAt,
            updatedAt,
          })
          .pipe(
            Effect.mapError(() =>
              requestError(
                "import_persistence_failed",
                "The imported thread could not be saved.",
                true,
              ),
            ),
          );
        return result.threadId ?? input.threadId;
      }),
    randomId: crypto.randomUUIDv4.pipe(
      Effect.mapError(() =>
        requestError(
          "random_source_failed",
          "A secure import identifier could not be created.",
          true,
        ),
      ),
    ),
    now: Effect.map(DateTime.now, DateTime.toEpochMillis),
    prepareProjectMatcher: (projectRoot) =>
      prepareRepositoryIdentityMatcher(projectRoot).pipe(
        Effect.provideService(FileSystem.FileSystem, fileSystem),
        Effect.provideService(Path.Path, path),
        Effect.provideService(VcsProcess.VcsProcess, vcsProcess),
        Effect.mapError(() =>
          requestError(
            "repository_identity_failed",
            "The thread repository identity could not be verified.",
          ),
        ),
      ),
    matchesProject: () =>
      Effect.fail(
        requestError(
          "repository_identity_failed",
          "The repository identity matcher was not prepared.",
        ),
      ),
  });
  return ExternalThreadImportService.of(service);
});

export const layer = Layer.effect(ExternalThreadImportService, makeLive);
