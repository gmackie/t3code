import {
  DateTime,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  PubSub,
  Random,
  Scope,
  Semaphore,
  Stream,
  SynchronizedRef,
} from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import type * as EffectAcpSchema from "effect-acp/schema";

import {
  ApprovalRequestId,
  EventId,
  RuntimeRequestId,
  type ProviderApprovalDecision,
  type ProviderInteractionMode,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type RuntimeMode,
  type ThreadId,
  TurnId,
} from "@t3tools/contracts";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "../Errors.ts";
import { acpPermissionOutcome, mapAcpToAdapterError } from "../acp/AcpAdapterSupport.ts";
import {
  makeAcpAssistantItemEvent,
  makeAcpContentDeltaEvent,
  makeAcpRequestOpenedEvent,
  makeAcpRequestResolvedEvent,
  makeAcpToolCallEvent,
} from "../acp/AcpCoreRuntimeEvents.ts";
import {
  type AcpSessionMode,
  type AcpSessionModeState,
  parsePermissionRequest,
} from "../acp/AcpRuntimeModel.ts";
import { makeSmolAgentAcpRuntime } from "../acp/SmolAgentAcpSupport.ts";
import { SmolAgentAdapter, type SmolAgentAdapterShape } from "../Services/SmolAgentAdapter.ts";
import type { AcpSessionRuntimeShape } from "../acp/AcpSessionRuntime.ts";

const PROVIDER = "smolAgent" as const;
const SMOL_AGENT_RESUME_VERSION = 1 as const;
const ACP_PLAN_MODE_ALIASES = ["plan", "architect"];
const ACP_IMPLEMENT_MODE_ALIASES = ["code", "default", "chat", "agent", "implement"];

interface PendingApproval {
  readonly decision: Deferred.Deferred<ProviderApprovalDecision>;
  readonly kind: string | "unknown";
}

interface SmolAgentSessionContext {
  readonly threadId: ThreadId;
  session: ProviderSession;
  readonly scope: Scope.Closeable;
  readonly acp: AcpSessionRuntimeShape;
  notificationFiber: Fiber.Fiber<void, never> | undefined;
  readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>;
  readonly turns: Array<{ id: TurnId; items: Array<unknown> }>;
  activeTurnId: TurnId | undefined;
  stopped: boolean;
}

function settlePendingApprovalsAsCancelled(
  pendingApprovals: ReadonlyMap<ApprovalRequestId, PendingApproval>,
): Effect.Effect<void> {
  return Effect.forEach(
    Array.from(pendingApprovals.values()),
    (pending) => Deferred.succeed(pending.decision, "cancel").pipe(Effect.ignore),
    { discard: true },
  );
}

function normalizeModeSearchText(mode: AcpSessionMode): string {
  return [mode.id, mode.name, mode.description]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findModeByAliases(
  modes: ReadonlyArray<AcpSessionMode>,
  aliases: ReadonlyArray<string>,
): AcpSessionMode | undefined {
  const normalizedAliases = aliases.map((alias) => alias.toLowerCase());
  for (const alias of normalizedAliases) {
    const exact = modes.find((mode) => {
      const id = mode.id.toLowerCase();
      const name = mode.name.toLowerCase();
      return id === alias || name === alias;
    });
    if (exact) {
      return exact;
    }
  }
  for (const alias of normalizedAliases) {
    const partial = modes.find((mode) => normalizeModeSearchText(mode).includes(alias));
    if (partial) {
      return partial;
    }
  }
  return undefined;
}

function resolveRequestedModeId(input: {
  readonly interactionMode: ProviderInteractionMode | undefined;
  readonly modeState: AcpSessionModeState | undefined;
  readonly runtimeMode: RuntimeMode;
}): string | undefined {
  const modeState = input.modeState;
  if (!modeState) {
    return undefined;
  }
  if (input.interactionMode === "plan") {
    return findModeByAliases(modeState.availableModes, ACP_PLAN_MODE_ALIASES)?.id;
  }
  return (
    findModeByAliases(modeState.availableModes, ACP_IMPLEMENT_MODE_ALIASES)?.id ??
    modeState.currentModeId
  );
}

function parseSmolAgentResume(raw: unknown): { sessionId: string } | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  if (record.schemaVersion !== SMOL_AGENT_RESUME_VERSION) {
    return undefined;
  }
  if (typeof record.sessionId !== "string" || !record.sessionId.trim()) {
    return undefined;
  }
  return { sessionId: record.sessionId.trim() };
}

function selectAutoApprovedPermissionOption(
  request: EffectAcpSchema.RequestPermissionRequest,
): string | undefined {
  const allowAlways = request.options.find((option) => option.kind === "allow_always");
  if (allowAlways?.optionId?.trim()) {
    return allowAlways.optionId.trim();
  }
  const allowOnce = request.options.find((option) => option.kind === "allow_once");
  if (allowOnce?.optionId?.trim()) {
    return allowOnce.optionId.trim();
  }
  return undefined;
}

export function makeSmolAgentAdapterLive() {
  return Layer.effect(
    SmolAgentAdapter,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const serverConfig = yield* ServerConfig;
      const serverSettingsService = yield* ServerSettingsService;

      const sessions = new Map<ThreadId, SmolAgentSessionContext>();
      const threadLocksRef = yield* SynchronizedRef.make(new Map<string, Semaphore.Semaphore>());
      const runtimeEventPubSub = yield* PubSub.unbounded<ProviderRuntimeEvent>();

      const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
      const nextEventId = Effect.map(Random.nextUUIDv4, (id) => EventId.make(id));
      const makeEventStamp = () => Effect.all({ eventId: nextEventId, createdAt: nowIso });
      const offerRuntimeEvent = (event: ProviderRuntimeEvent) =>
        PubSub.publish(runtimeEventPubSub, event).pipe(Effect.asVoid);

      const getThreadSemaphore = (threadId: string) =>
        SynchronizedRef.modifyEffect(threadLocksRef, (current) => {
          const existing = current.get(threadId);
          if (existing) {
            return Effect.succeed([existing, current] as const);
          }
          return Semaphore.make(1).pipe(
            Effect.map((semaphore) => {
              const next = new Map(current);
              next.set(threadId, semaphore);
              return [semaphore, next] as const;
            }),
          );
        });

      const withThreadLock = <A, E, R>(threadId: string, effect: Effect.Effect<A, E, R>) =>
        Effect.flatMap(getThreadSemaphore(threadId), (semaphore) => semaphore.withPermit(effect));

      const requireSession = (
        threadId: ThreadId,
      ): Effect.Effect<SmolAgentSessionContext, ProviderAdapterSessionNotFoundError> => {
        const ctx = sessions.get(threadId);
        if (!ctx || ctx.stopped) {
          return Effect.fail(
            new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }),
          );
        }
        return Effect.succeed(ctx);
      };

      const stopSessionInternal = (ctx: SmolAgentSessionContext) =>
        Effect.gen(function* () {
          if (ctx.stopped) return;
          ctx.stopped = true;
          yield* settlePendingApprovalsAsCancelled(ctx.pendingApprovals);
          if (ctx.notificationFiber) {
            yield* Fiber.interrupt(ctx.notificationFiber);
          }
          yield* Effect.ignore(Scope.close(ctx.scope, Exit.void));
          sessions.delete(ctx.threadId);
          yield* offerRuntimeEvent({
            type: "session.exited",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            threadId: ctx.threadId,
            payload: { exitKind: "graceful" },
          });
        });

      const startSession: SmolAgentAdapterShape["startSession"] = (input) =>
        withThreadLock(
          input.threadId,
          Effect.gen(function* () {
            if (input.provider !== undefined && input.provider !== PROVIDER) {
              return yield* new ProviderAdapterValidationError({
                provider: PROVIDER,
                operation: "startSession",
                issue: `Expected provider '${PROVIDER}' but received '${input.provider}'.`,
              });
            }
            if (!input.cwd?.trim()) {
              return yield* new ProviderAdapterValidationError({
                provider: PROVIDER,
                operation: "startSession",
                issue: "cwd is required and must be non-empty.",
              });
            }
            if (input.modelSelection?.provider !== PROVIDER) {
              return yield* new ProviderAdapterValidationError({
                provider: PROVIDER,
                operation: "startSession",
                issue: "smol-agent sessions require a smolAgent model selection.",
              });
            }

            const cwd = input.cwd.trim();
            const existing = sessions.get(input.threadId);
            if (existing && !existing.stopped) {
              yield* stopSessionInternal(existing);
            }

            const settings = yield* serverSettingsService.getSettings.pipe(
              Effect.map((serverSettings) => serverSettings.providers.smolAgent),
              Effect.mapError(
                (error) =>
                  new ProviderAdapterProcessError({
                    provider: PROVIDER,
                    threadId: input.threadId,
                    detail: error.message,
                    cause: error,
                  }),
              ),
            );

            const pendingApprovals = new Map<ApprovalRequestId, PendingApproval>();
            const sessionScope = yield* Scope.make("sequential");
            let sessionScopeTransferred = false;
            yield* Effect.addFinalizer(() =>
              sessionScopeTransferred ? Effect.void : Scope.close(sessionScope, Exit.void),
            );

            const resumeSessionId = parseSmolAgentResume(input.resumeCursor)?.sessionId;
            const acp = yield* makeSmolAgentAcpRuntime({
              smolAgentSettings: settings,
              childProcessSpawner,
              cwd,
              model: input.modelSelection.model,
              ...(resumeSessionId ? { resumeSessionId } : {}),
              clientInfo: { name: "t3-code", version: "0.0.0" },
            }).pipe(
              Effect.provideService(Scope.Scope, sessionScope),
              Effect.mapError(
                (cause) =>
                  new ProviderAdapterProcessError({
                    provider: PROVIDER,
                    threadId: input.threadId,
                    detail: cause.message,
                    cause,
                  }),
              ),
            );

            let ctx!: SmolAgentSessionContext;
            const started = yield* Effect.gen(function* () {
              yield* acp.handleRequestPermission((params) =>
                Effect.gen(function* () {
                  if (input.runtimeMode === "full-access") {
                    const optionId = selectAutoApprovedPermissionOption(params);
                    if (optionId !== undefined) {
                      return {
                        outcome: {
                          outcome: "selected" as const,
                          optionId,
                        },
                      };
                    }
                  }
                  const permissionRequest = parsePermissionRequest(params);
                  const requestId = ApprovalRequestId.make(crypto.randomUUID());
                  const runtimeRequestId = RuntimeRequestId.make(requestId);
                  const decision = yield* Deferred.make<ProviderApprovalDecision>();
                  pendingApprovals.set(requestId, {
                    decision,
                    kind: permissionRequest.kind,
                  });
                  yield* offerRuntimeEvent(
                    makeAcpRequestOpenedEvent({
                      stamp: yield* makeEventStamp(),
                      provider: PROVIDER,
                      threadId: input.threadId,
                      turnId: ctx?.activeTurnId,
                      requestId: runtimeRequestId,
                      permissionRequest,
                      detail: permissionRequest.detail ?? JSON.stringify(params).slice(0, 2000),
                      args: params,
                      source: "acp.jsonrpc",
                      method: "session/request_permission",
                      rawPayload: params,
                    }),
                  );
                  const resolved = yield* Deferred.await(decision);
                  pendingApprovals.delete(requestId);
                  yield* offerRuntimeEvent(
                    makeAcpRequestResolvedEvent({
                      stamp: yield* makeEventStamp(),
                      provider: PROVIDER,
                      threadId: input.threadId,
                      turnId: ctx?.activeTurnId,
                      requestId: runtimeRequestId,
                      permissionRequest,
                      decision: resolved,
                    }),
                  );
                  return {
                    outcome:
                      resolved === "cancel"
                        ? ({ outcome: "cancelled" } as const)
                        : {
                            outcome: "selected" as const,
                            optionId: acpPermissionOutcome(resolved),
                          },
                  };
                }),
              );
              return yield* acp.start();
            }).pipe(
              Effect.mapError((error) =>
                mapAcpToAdapterError(PROVIDER, input.threadId, "session/start", error),
              ),
            );

            const now = yield* nowIso;
            const session: ProviderSession = {
              provider: PROVIDER,
              status: "ready",
              runtimeMode: input.runtimeMode,
              cwd,
              model: input.modelSelection.model,
              threadId: input.threadId,
              resumeCursor: {
                schemaVersion: SMOL_AGENT_RESUME_VERSION,
                sessionId: started.sessionId,
              },
              createdAt: now,
              updatedAt: now,
            };

            ctx = {
              threadId: input.threadId,
              session,
              scope: sessionScope,
              acp,
              notificationFiber: undefined,
              pendingApprovals,
              turns: [],
              activeTurnId: undefined,
              stopped: false,
            };

            const notificationFiber = yield* Stream.runDrain(
              Stream.mapEffect(acp.getEvents(), (event) =>
                Effect.gen(function* () {
                  switch (event._tag) {
                    case "ModeChanged":
                      return;
                    case "AssistantItemStarted":
                      yield* offerRuntimeEvent(
                        makeAcpAssistantItemEvent({
                          stamp: yield* makeEventStamp(),
                          provider: PROVIDER,
                          threadId: ctx.threadId,
                          turnId: ctx.activeTurnId,
                          itemId: event.itemId,
                          lifecycle: "item.started",
                        }),
                      );
                      return;
                    case "AssistantItemCompleted":
                      yield* offerRuntimeEvent(
                        makeAcpAssistantItemEvent({
                          stamp: yield* makeEventStamp(),
                          provider: PROVIDER,
                          threadId: ctx.threadId,
                          turnId: ctx.activeTurnId,
                          itemId: event.itemId,
                          lifecycle: "item.completed",
                        }),
                      );
                      return;
                    case "ToolCallUpdated":
                      yield* offerRuntimeEvent(
                        makeAcpToolCallEvent({
                          stamp: yield* makeEventStamp(),
                          provider: PROVIDER,
                          threadId: ctx.threadId,
                          turnId: ctx.activeTurnId,
                          toolCall: event.toolCall,
                          rawPayload: event.rawPayload,
                        }),
                      );
                      return;
                    case "ContentDelta":
                      yield* offerRuntimeEvent(
                        makeAcpContentDeltaEvent({
                          stamp: yield* makeEventStamp(),
                          provider: PROVIDER,
                          threadId: ctx.threadId,
                          turnId: ctx.activeTurnId,
                          ...(event.itemId ? { itemId: event.itemId } : {}),
                          text: event.text,
                          rawPayload: event.rawPayload,
                        }),
                      );
                      return;
                    case "PlanUpdated":
                      return;
                  }
                }),
              ),
            ).pipe(Effect.forkChild);

            ctx.notificationFiber = notificationFiber;
            sessions.set(input.threadId, ctx);
            sessionScopeTransferred = true;

            yield* offerRuntimeEvent({
              type: "session.started",
              ...(yield* makeEventStamp()),
              provider: PROVIDER,
              threadId: input.threadId,
              payload: { resume: started.initializeResult },
            });
            yield* offerRuntimeEvent({
              type: "session.state.changed",
              ...(yield* makeEventStamp()),
              provider: PROVIDER,
              threadId: input.threadId,
              payload: { state: "ready", reason: "smol-agent ACP session ready" },
            });
            yield* offerRuntimeEvent({
              type: "thread.started",
              ...(yield* makeEventStamp()),
              provider: PROVIDER,
              threadId: input.threadId,
              payload: { providerThreadId: started.sessionId },
            });

            return session;
          }).pipe(Effect.scoped),
        );

      const sendTurn: SmolAgentAdapterShape["sendTurn"] = (input) =>
        Effect.gen(function* () {
          const ctx = yield* requireSession(input.threadId);
          const turnId = TurnId.make(crypto.randomUUID());
          const requestedModeId = resolveRequestedModeId({
            interactionMode: input.interactionMode,
            runtimeMode: ctx.session.runtimeMode,
            modeState: yield* ctx.acp.getModeState,
          });
          if (requestedModeId) {
            yield* ctx.acp
              .setMode(requestedModeId)
              .pipe(
                Effect.mapError((error) =>
                  mapAcpToAdapterError(PROVIDER, input.threadId, "session/set_mode", error),
                ),
              );
          }

          ctx.activeTurnId = turnId;
          ctx.session = {
            ...ctx.session,
            activeTurnId: turnId,
            updatedAt: yield* nowIso,
          };

          yield* offerRuntimeEvent({
            type: "turn.started",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            threadId: input.threadId,
            turnId,
            payload: { model: ctx.session.model },
          });

          const promptParts: Array<EffectAcpSchema.ContentBlock> = [];
          if (input.input?.trim()) {
            promptParts.push({ type: "text", text: input.input.trim() });
          }
          if (input.attachments && input.attachments.length > 0) {
            for (const attachment of input.attachments) {
              const attachmentPath = resolveAttachmentPath({
                attachmentsDir: serverConfig.attachmentsDir,
                attachment,
              });
              if (!attachmentPath) {
                return yield* new ProviderAdapterRequestError({
                  provider: PROVIDER,
                  method: "session/prompt",
                  detail: `Invalid attachment id '${attachment.id}'.`,
                });
              }
              const bytes = yield* fileSystem.readFile(attachmentPath).pipe(
                Effect.mapError(
                  (cause) =>
                    new ProviderAdapterRequestError({
                      provider: PROVIDER,
                      method: "session/prompt",
                      detail: cause.message,
                      cause,
                    }),
                ),
              );
              promptParts.push({
                type: "image",
                data: Buffer.from(bytes).toString("base64"),
                mimeType: attachment.mimeType,
              });
            }
          }

          if (promptParts.length === 0) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "sendTurn",
              issue: "Turn requires non-empty text or attachments.",
            });
          }

          const result = yield* ctx.acp
            .prompt({ prompt: promptParts })
            .pipe(
              Effect.mapError((error) =>
                mapAcpToAdapterError(PROVIDER, input.threadId, "session/prompt", error),
              ),
            );

          ctx.turns.push({ id: turnId, items: [{ prompt: promptParts, result }] });
          ctx.session = {
            ...ctx.session,
            activeTurnId: turnId,
            updatedAt: yield* nowIso,
          };

          yield* offerRuntimeEvent({
            type: "turn.completed",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            threadId: input.threadId,
            turnId,
            payload: {
              state: result.stopReason === "cancelled" ? "cancelled" : "completed",
              stopReason: result.stopReason ?? null,
            },
          });

          return {
            threadId: input.threadId,
            turnId,
            resumeCursor: ctx.session.resumeCursor,
          };
        });

      const interruptTurn: SmolAgentAdapterShape["interruptTurn"] = (threadId) =>
        Effect.gen(function* () {
          const ctx = yield* requireSession(threadId);
          yield* settlePendingApprovalsAsCancelled(ctx.pendingApprovals);
          yield* Effect.ignore(
            ctx.acp.cancel.pipe(
              Effect.mapError((error) =>
                mapAcpToAdapterError(PROVIDER, threadId, "session/cancel", error),
              ),
            ),
          );
        });

      const respondToRequest: SmolAgentAdapterShape["respondToRequest"] = (
        threadId,
        requestId,
        decision,
      ) =>
        Effect.gen(function* () {
          const ctx = yield* requireSession(threadId);
          const pending = ctx.pendingApprovals.get(requestId);
          if (!pending) {
            return yield* new ProviderAdapterRequestError({
              provider: PROVIDER,
              method: "session/request_permission",
              detail: `Unknown pending approval request: ${requestId}`,
            });
          }
          yield* Deferred.succeed(pending.decision, decision);
        });

      const respondToUserInput: SmolAgentAdapterShape["respondToUserInput"] = (
        threadId,
        requestId,
      ) =>
        Effect.gen(function* () {
          yield* requireSession(threadId);
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "session/prompt",
            detail: `Unknown pending user-input request: ${requestId}`,
          });
        });

      const readThread: SmolAgentAdapterShape["readThread"] = (threadId) =>
        Effect.gen(function* () {
          const ctx = yield* requireSession(threadId);
          return { threadId, turns: ctx.turns };
        });

      const rollbackThread: SmolAgentAdapterShape["rollbackThread"] = (threadId, numTurns) =>
        Effect.gen(function* () {
          const ctx = yield* requireSession(threadId);
          if (!Number.isInteger(numTurns) || numTurns < 1) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "rollbackThread",
              issue: "numTurns must be an integer >= 1.",
            });
          }
          const nextLength = Math.max(0, ctx.turns.length - numTurns);
          ctx.turns.splice(nextLength);
          return { threadId, turns: ctx.turns };
        });

      const stopSession: SmolAgentAdapterShape["stopSession"] = (threadId) =>
        withThreadLock(
          threadId,
          Effect.gen(function* () {
            const ctx = yield* requireSession(threadId);
            yield* stopSessionInternal(ctx);
          }),
        );

      const listSessions: SmolAgentAdapterShape["listSessions"] = () =>
        Effect.sync(() => Array.from(sessions.values(), (ctx) => ({ ...ctx.session })));

      const hasSession: SmolAgentAdapterShape["hasSession"] = (threadId) =>
        Effect.sync(() => {
          const ctx = sessions.get(threadId);
          return ctx !== undefined && !ctx.stopped;
        });

      const stopAll: SmolAgentAdapterShape["stopAll"] = () =>
        Effect.forEach(sessions.values(), stopSessionInternal, { discard: true });

      yield* Effect.addFinalizer(() =>
        Effect.forEach(sessions.values(), stopSessionInternal, { discard: true }).pipe(
          Effect.tap(() => PubSub.shutdown(runtimeEventPubSub)),
        ),
      );

      return {
        provider: PROVIDER,
        capabilities: { sessionModelSwitch: "unsupported" },
        startSession,
        sendTurn,
        interruptTurn,
        respondToRequest,
        respondToUserInput,
        stopSession,
        listSessions,
        hasSession,
        readThread,
        rollbackThread,
        stopAll,
        streamEvents: Stream.fromPubSub(runtimeEventPubSub),
      } satisfies SmolAgentAdapterShape;
    }),
  );
}

export const SmolAgentAdapterLive = makeSmolAgentAdapterLive();
