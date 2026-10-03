import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  CommandId,
  EventId,
  ExternalThreadImportRequestError,
  MessageId,
  TurnItemId,
  type EnvironmentId,
  type ExternalThreadImportProvenance,
  type ExternalThreadImportBatchResult,
  type ExternalThreadImportCandidateToken,
  type ExternalThreadImportDiscoveryInput,
  type ExternalThreadImportDiscoveryResult,
  type ExternalThreadImportSelection,
  type ModelSelection,
  type OrchestrationV2AppThread,
  type OrchestrationV2ConversationMessage,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ProviderThread,
  type OrchestrationV2TurnItem,
  type ProjectId,
  type ProviderInstanceRef,
  type ProviderThreadId,
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
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as IdAllocator from "../orchestration-v2/IdAllocator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProviderSessionRuntime from "../persistence/ProviderSessionRuntime.ts";
import * as ProjectService from "../project/ProjectService.ts";
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
  NormalizedThreadImportHistory,
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

const IMPORT_EVENT_PREFIX = "external-thread-import:v2";
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

const historyItemAt = (importedAt: string, sequence: number): DateTime.Utc =>
  DateTime.add(DateTime.makeUnsafe(importedAt), { milliseconds: sequence });

const toolSummary = (value: unknown): string | undefined => {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return undefined;
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
};

/**
 * Translate a normalized import history into V2 domain events. Messages become
 * conversation messages plus their turn items; everything else becomes a
 * completed turn item so the imported transcript reads like a settled run.
 * Imported items carry no run: the provider never ran them under T3 Code.
 */
export function buildImportedThreadEvents(input: {
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly modelSelection: ModelSelection;
  readonly providerThreadId: ProviderThreadId;
  readonly provenance: ExternalThreadImportProvenance;
  readonly history: NormalizedThreadImportHistory;
  readonly createdAt: string;
  readonly updatedAt: string;
}): ReadonlyArray<OrchestrationV2DomainEvent> {
  const threadId = input.threadId;
  const driver = input.provenance.provider.driver;
  const providerInstanceId = input.provenance.provider.instanceId;
  const createdAt = DateTime.makeUnsafe(input.createdAt);
  const updatedAt = DateTime.makeUnsafe(input.updatedAt);
  const appThread: OrchestrationV2AppThread = {
    createdBy: "system",
    creationSource: "server",
    id: threadId,
    projectId: input.projectId,
    title: input.title.trim() === "" ? "Imported thread" : input.title,
    providerInstanceId,
    modelSelection: input.modelSelection,
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
    branch: null,
    worktreePath: null,
    linkedPullRequest: null,
    branchPullRequest: null,
    activeProviderThreadId: input.providerThreadId,
    historyOrigin: "v1_import",
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
    forkedFrom: null,
    createdAt,
    updatedAt,
    archivedAt: null,
    settledOverride: "settled",
    settledAt: updatedAt,
    unsettledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
    pinOrderKey: null,
    activeOrderKey: null,
    lastVisitedAt: null,
    deletedAt: null,
  };
  const providerThread: OrchestrationV2ProviderThread = {
    id: input.providerThreadId,
    driver,
    providerInstanceId,
    providerSessionId: null,
    appThreadId: threadId,
    ownerNodeId: null,
    nativeThreadRef: { driver, nativeId: input.provenance.nativeThreadId, strength: "strong" },
    nativeConversationHeadRef: null,
    status: "idle",
    firstRunOrdinal: null,
    lastRunOrdinal: null,
    handoffIds: [],
    forkedFrom: null,
    pendingBackgroundTasks: [],
    createdAt,
    updatedAt,
  };
  const events: Array<OrchestrationV2DomainEvent> = [
    {
      id: EventId.make(`${IMPORT_EVENT_PREFIX}:thread:${threadId}:created`),
      type: "thread.created",
      threadId,
      providerInstanceId,
      occurredAt: createdAt,
      payload: appThread,
    },
  ];
  const toolCallIds = new Map<string, TurnItemId>();
  let ordinal = 0;
  const base = (sequence: number) => {
    ordinal += 1;
    const at = historyItemAt(input.provenance.importedAt, sequence);
    const suffix = String(sequence).padStart(8, "0");
    return {
      at,
      suffix,
      fields: {
        id: TurnItemId.make(`${IMPORT_EVENT_PREFIX}:turn-item:${threadId}:${suffix}`),
        threadId,
        runId: null,
        nodeId: null,
        providerThreadId: input.providerThreadId,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal,
        status: "completed" as const,
        title: null,
        startedAt: at,
        completedAt: at,
        updatedAt: at,
      },
    };
  };
  const emitItem = (suffix: string, at: DateTime.Utc, turnItem: OrchestrationV2TurnItem) => {
    events.push({
      id: EventId.make(`${IMPORT_EVENT_PREFIX}:turn-item:${threadId}:${suffix}`),
      type: "turn-item.updated",
      threadId,
      driver,
      providerInstanceId,
      occurredAt: at,
      payload: turnItem,
    });
  };
  for (const item of input.history) {
    switch (item._tag) {
      case "TurnLifecycle":
        continue;
      case "Message": {
        const { at, suffix, fields } = base(item.sequence);
        const messageId = MessageId.make(`import:${threadId}:message:${item.sequence}`);
        const message: OrchestrationV2ConversationMessage = {
          createdBy: item.role === "user" ? "user" : "agent",
          creationSource: "server",
          id: messageId,
          threadId,
          runId: null,
          nodeId: null,
          role: item.role,
          text: item.text,
          attachments: [],
          streaming: false,
          createdAt: at,
          updatedAt: at,
        };
        events.push({
          id: EventId.make(`${IMPORT_EVENT_PREFIX}:message:${threadId}:${suffix}`),
          type: "message.updated",
          threadId,
          occurredAt: at,
          payload: message,
        });
        emitItem(
          suffix,
          at,
          item.role === "user"
            ? {
                ...fields,
                createdBy: "user",
                creationSource: "server",
                type: "user_message",
                messageId,
                inputIntent: "turn_start",
                text: item.text,
                attachments: [],
              }
            : {
                ...fields,
                type: "assistant_message",
                messageId,
                text: item.text,
                streaming: false,
              },
        );
        continue;
      }
      case "Reasoning": {
        const { at, suffix, fields } = base(item.sequence);
        emitItem(suffix, at, { ...fields, type: "reasoning", text: item.text, streaming: false });
        continue;
      }
      case "ToolCall": {
        const { at, suffix, fields } = base(item.sequence);
        toolCallIds.set(item.callId, fields.id);
        emitItem(suffix, at, {
          ...fields,
          type: "dynamic_tool",
          toolName: item.name.trim() === "" ? null : item.name,
          input: item.input,
        });
        continue;
      }
      case "ToolResult": {
        const { at, suffix, fields } = base(item.sequence);
        const parentItemId = toolCallIds.get(item.callId) ?? null;
        emitItem(suffix, at, {
          ...fields,
          parentItemId,
          status: item.isError ? "failed" : "completed",
          type: "dynamic_tool",
          toolName: null,
          input: { callId: item.callId },
          output: item.output,
        });
        continue;
      }
      case "Approval": {
        const { at, suffix, fields } = base(item.sequence);
        emitItem(suffix, at, {
          ...fields,
          type: "system_notice",
          message: `Approval ${item.decision}: ${item.prompt}`,
        });
        continue;
      }
      case "UserInput": {
        const { at, suffix, fields } = base(item.sequence);
        emitItem(suffix, at, {
          ...fields,
          type: "system_notice",
          message: item.response === undefined ? item.prompt : `${item.prompt}\n\n${item.response}`,
        });
        continue;
      }
      case "Error": {
        const { at, suffix, fields } = base(item.sequence);
        emitItem(suffix, at, {
          ...fields,
          status: "failed",
          type: "system_notice",
          message: item.code === undefined ? item.message : `${item.code}: ${item.message}`,
        });
        continue;
      }
      case "Activity": {
        const { at, suffix, fields } = base(item.sequence);
        const detail = toolSummary(item.detail);
        emitItem(suffix, at, {
          ...fields,
          type: "system_notice",
          message: detail === undefined ? item.label : `${item.label}: ${detail}`,
        });
        continue;
      }
    }
  }
  events.push({
    id: EventId.make(`${IMPORT_EVENT_PREFIX}:provider-thread:${input.providerThreadId}`),
    type: "provider-thread.updated",
    threadId,
    driver,
    providerInstanceId,
    occurredAt: updatedAt,
    payload: providerThread,
  });
  return events;
}

export const makeLive = Effect.gen(function* () {
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const projects = yield* ProjectService.ProjectService;
  const instances = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const tokenCodec = yield* CandidateToken.ExternalThreadImportCandidateTokenCodec;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const eventSink = yield* EventSink.EventSinkV2;
  const idAllocator = yield* IdAllocator.IdAllocatorV2;
  const runtimes = yield* ProviderSessionRuntime.ProviderSessionRuntimeRepository;
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
      projects.getById(projectId).pipe(
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
      Effect.gen(function* () {
        const instance = yield* instances.getInstance(identity.provider.instanceId);
        if (instance === undefined) return undefined;
        const rows = yield* sql<{ readonly threadId: string }>`
          SELECT thread_id AS "threadId"
          FROM projection_external_thread_imports
          WHERE environment_id = ${identity.environmentId}
            AND continuation_group = ${instance.continuationIdentity.continuationKey}
            AND provider_instance_id = ${identity.provider.instanceId}
            AND provider_driver = ${identity.provider.driver}
            AND native_thread_id = ${identity.nativeThreadId}
          LIMIT 1
        `;
        const row = rows[0];
        if (row === undefined) return undefined;
        const threadId = ThreadIdSchema.make(row.threadId);
        // The provenance row outlives the thread when the user deletes it.
        // Treat a deleted or vanished thread as never imported so the native
        // thread can be imported again, and drop the stale row.
        const existing = yield* projections.getThread(threadId).pipe(
          Effect.map((thread) => thread.deletedAt === null),
          Effect.orElseSucceed(() => false),
        );
        if (existing) return threadId;
        yield* sql`
          DELETE FROM projection_external_thread_imports
          WHERE thread_id = ${threadId}
        `;
        return undefined;
      }).pipe(
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
        const provenance: ExternalThreadImportProvenance = {
          provider: input.identity.provider,
          nativeThreadId: input.identity.nativeThreadId,
          continuationGroup: instance.continuationIdentity.continuationKey,
          originalCwd: input.snapshot.recordedCwd,
          ...(input.snapshot.resumeCursor === undefined
            ? {}
            : { resumeCursor: input.snapshot.resumeCursor }),
          decoderVersion: input.snapshot.decoderVersion,
          importedAt,
        };
        const persistenceError = () =>
          requestError(
            "import_persistence_failed",
            "The imported thread could not be saved.",
            true,
          );
        const driver = input.identity.provider.driver;
        const providerThreadId = idAllocator.derive.providerThread({
          driver,
          nativeThreadId: input.identity.nativeThreadId,
          providerInstanceId: input.identity.provider.instanceId,
        });
        const events = buildImportedThreadEvents({
          threadId: input.threadId,
          projectId: input.identity.projectId,
          title:
            input.snapshot.metadata.title ??
            input.snapshot.metadata.firstPromptPreview ??
            "Imported thread",
          modelSelection: input.modelSelection,
          providerThreadId,
          provenance,
          history: input.snapshot.normalizedHistory,
          createdAt,
          updatedAt,
        });
        const stored = yield* eventSink
          .write({ commandId: CommandId.make(input.commandId), events })
          .pipe(Effect.mapError(persistenceError));
        yield* runtimes
          .upsert({
            threadId: input.threadId,
            providerName: driver,
            providerInstanceId: input.identity.provider.instanceId,
            adapterKey: driver,
            runtimeMode: DEFAULT_RUNTIME_MODE,
            status: "stopped",
            lastSeenAt: importedAt,
            resumeCursor: input.snapshot.resumeCursor ?? null,
            runtimePayload: {
              cwd: input.snapshot.recordedCwd,
              modelSelection: input.modelSelection,
            },
          })
          .pipe(Effect.mapError(persistenceError));
        const resumeCursorJson =
          provenance.resumeCursor === undefined
            ? null
            : yield* encodeJson(provenance.resumeCursor).pipe(Effect.mapError(persistenceError));
        yield* sql`
          INSERT INTO projection_external_thread_imports (
            thread_id, environment_id, provider_instance_id, provider_driver, continuation_group,
            native_thread_id, original_cwd, resume_cursor_json, decoder_version,
            imported_at, event_sequence
          ) VALUES (
            ${input.threadId}, ${input.identity.environmentId}, ${provenance.provider.instanceId},
            ${provenance.provider.driver}, ${provenance.continuationGroup},
            ${provenance.nativeThreadId}, ${provenance.originalCwd},
            ${resumeCursorJson},
            ${provenance.decoderVersion}, ${provenance.importedAt}, ${stored.at(-1)?.sequence ?? 0}
          )
          ON CONFLICT(thread_id) DO UPDATE SET
            resume_cursor_json = excluded.resume_cursor_json,
            decoder_version = excluded.decoder_version,
            imported_at = excluded.imported_at,
            event_sequence = excluded.event_sequence
        `.pipe(Effect.mapError(persistenceError));
        return input.threadId;
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
