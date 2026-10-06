import * as NodeCrypto from "node:crypto";
import {
  CommandId,
  MessageId,
  UnityHookWatch,
  GameCatalog,
  GameRequest,
  GameState,
  UnityHookError,
  type ThreadId,
  type UnityBridgeConnection,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as Schedule from "effect/Schedule";
import * as UnityHooks from "./UnityHooks.ts";
import * as GameTransport from "./GameTransport.ts";
import * as HtmlRender from "../htmlRender/HtmlRender.ts";
import { gameReport } from "./gameReport.ts";

interface Viewer {
  readonly cwd: string;
  readonly threadId: ThreadId;
  readonly canOperate: boolean;
  readonly role: "human" | "agent";
  readonly expiresAt: number;
}
interface Session {
  readonly viewer: string;
  readonly bridge: UnityBridgeConnection;
  readonly catalog: GameCatalog;
  lease?: string;
}
export class GameSessions extends Context.Service<
  GameSessions,
  {
    readonly ticket: (input: {
      cwd: string;
      threadId: ThreadId;
      canOperate: boolean;
      role: "human" | "agent";
    }) => Effect.Effect<{ token: string; expiresAt: number; canOperate: boolean }, UnityHookError>;
    readonly configuration: (
      ticket: string,
    ) => Effect.Effect<{ cwd: string; canOperate: boolean }, UnityHookError>;
    readonly request: (
      ticket: string,
      request: GameRequest,
    ) => Effect.Effect<unknown, UnityHookError>;
    readonly agentSnapshot: (
      threadId: ThreadId,
      sessionId: string,
    ) => Effect.Effect<
      { screenshot: { mimeType: "image/jpeg"; data: string; width: number; height: number } },
      UnityHookError
    >;
    readonly agentRequest: (
      threadId: ThreadId,
      request: GameRequest,
    ) => Effect.Effect<unknown, UnityHookError>;
    readonly video: (
      ticket: string,
      sessionId: string,
      after?: string,
    ) => Effect.Effect<Uint8Array, UnityHookError>;
    readonly frame: (
      ticket: string,
      sessionId: string,
    ) => Effect.Effect<Uint8Array, UnityHookError>;
  }
>()("t3/game/GameSessions") {}
const decodeRequest = Schema.decodeUnknownEffect(GameRequest);
const decodeCatalog = Schema.decodeUnknownEffect(GameCatalog);
const decodeWatch = Schema.decodeUnknownEffect(UnityHookWatch);
const decodeState = Schema.decodeUnknownEffect(GameState);
const decodeLease = Schema.decodeUnknownEffect(
  Schema.Struct({ lease: Schema.String, expiresInMs: Schema.Number }),
);
const invalid = () =>
  new UnityHookError({
    code: "invalid_response",
    reason: "Unity returned incompatible game data.",
  });
const make = Effect.gen(function* () {
  const scope = yield* Effect.scope;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const hooks = yield* UnityHooks.UnityHooks;
  const transport = yield* GameTransport.GameTransport;
  const html = yield* HtmlRender.HtmlRender;
  const viewers = new Map<string, Viewer>();
  const sessions = new Map<string, Session>();
  const agents = new Map<ThreadId, string>();
  const notifications = new Set<string>();
  const notifyWatch = Effect.fn("GameSessions.notifyWatch")(function* (
    threadId: ThreadId,
    session: Session,
    watch: typeof UnityHookWatch.Type,
    durationMs: number,
  ) {
    const identity = `${session.bridge.generation}:${watch.id}`;
    notifications.add(identity);
    const deadline = (yield* Clock.currentTimeMillis) + durationMs;
    const seen = new Set<string>();
    const run = Effect.gen(function* () {
      let current = watch;
      let cursor = 0;
      while (true) {
        for (const receipt of current.receipts ?? []) {
          if (seen.has(receipt.id)) continue;
          const id = `unity-watch:${identity}:${receipt.id}`;
          yield* threads
            .dispatch({
              type: "message.dispatch",
              commandId: CommandId.make(id),
              messageId: MessageId.make(id),
              threadId,
              text: `Unity watch condition matched. ${JSON.stringify({ watchId: watch.id, target: session.catalog.target, generation: session.catalog.generation, predicate: current.predicate, receipt })}`,
              notification: {
                source: { kind: "monitor" },
                outcome: "updated",
                summary: `Unity watch condition matched (arm ${receipt.arm})`,
              },
              attachments: [],
              dispatchMode: { type: "queue_after_active" },
              createdBy: "agent",
              creationSource: "server",
            })
            .pipe(Effect.retry({ times: 2, schedule: Schedule.spaced("100 millis") }));
          seen.add(receipt.id);
        }
        if (current.status !== "active" || (yield* Clock.currentTimeMillis) >= deadline) return;
        cursor = Math.max(cursor, ...current.samples.map((sample) => sample.sequence));
        yield* Effect.sleep("250 millis");
        const state = yield* transport
          .command(session.bridge, {
            action: "state",
            generation: session.bridge.generation,
            afterSequence: cursor,
          })
          .pipe(Effect.flatMap(decodeState));
        if (state.generation !== watch.generation || state.monitor?.id !== watch.id) return;
        current = state.monitor;
      }
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("Unity watch notification delivery stopped", {
          watchId: watch.id,
          cause,
        }),
      ),
      Effect.ensuring(Effect.sync(() => notifications.delete(identity))),
    );
    yield* Effect.forkIn(run, scope);
  });
  const viewer = Effect.fn("GameSessions.viewer")(function* (token: string) {
    const now = yield* Clock.currentTimeMillis;
    for (const [key, value] of viewers)
      if (value.expiresAt <= now) {
        viewers.delete(key);
        for (const [thread, token] of agents) if (token === key) agents.delete(thread);
        for (const [id, session] of sessions) if (session.viewer === key) sessions.delete(id);
      }
    const found = viewers.get(token);
    if (!found)
      return yield* new UnityHookError({
        code: "viewer_expired",
        reason: "Reopen the game viewer to renew access.",
      });
    return found;
  });
  const ticket = Effect.fn("GameSessions.ticket")(function* (input: Omit<Viewer, "expiresAt">) {
    const expiresAt = (yield* Clock.currentTimeMillis) + 60 * 60_000;
    // Prune expired tickets even if no viewer has made a request since expiry.
    yield* viewer("").pipe(Effect.catch(() => Effect.void));
    if (viewers.size >= 64)
      return yield* new UnityHookError({
        code: "viewer_limit",
        reason: "Too many open game viewers.",
      });
    const token = NodeCrypto.randomBytes(32).toString("base64url");
    viewers.set(token, { ...input, expiresAt });
    return { token, expiresAt, canOperate: input.canOperate };
  });
  const getSession = Effect.fn("GameSessions.session")(function* (token: string, id: string) {
    yield* viewer(token);
    const session = sessions.get(id);
    if (!session || session.viewer !== token)
      return yield* new UnityHookError({
        code: "session_missing",
        reason: "Open this target in the game viewer first.",
      });
    return session;
  });
  const request = Effect.fn("GameSessions.request")(function* (token: string, raw: GameRequest) {
    const caller = yield* viewer(token);
    const input = yield* decodeRequest(raw).pipe(
      Effect.mapError(
        () => new UnityHookError({ code: "invalid_request", reason: "Invalid game request." }),
      ),
    );
    if (input.action !== "state" && input.action !== "close" && !caller.canOperate)
      return yield* new UnityHookError({
        code: "read_only",
        reason: "This environment connection cannot control gameplay.",
      });
    if (input.action === "cli") return yield* hooks.command(input.request);
    if (input.action === "open") {
      if ([...sessions.values()].filter((s) => s.viewer === token).length >= 4)
        return yield* new UnityHookError({
          code: "session_limit",
          reason: "Close an existing target before opening another.",
        });
      const bridge = yield* hooks.connect(input.target);
      const catalog = yield* transport
        .command(bridge, { action: "catalog", generation: bridge.generation })
        .pipe(
          Effect.flatMap(decodeCatalog),
          Effect.mapError((error) => (error instanceof UnityHookError ? error : invalid())),
        );
      if (catalog.generation !== bridge.generation || catalog.target !== input.target.kind)
        return yield* invalid();
      const sessionId = NodeCrypto.randomUUID();
      sessions.set(sessionId, { viewer: token, bridge, catalog });
      return { sessionId, catalog };
    }
    const session = yield* getSession(token, input.sessionId);
    const command = (data: object) =>
      transport.command(session.bridge, { ...data, generation: session.bridge.generation });
    if (input.action === "close") {
      sessions.delete(input.sessionId);
      if (session.lease)
        yield* command({ action: "release", lease: session.lease }).pipe(
          Effect.catch(() => Effect.void),
        );
      return { closed: true };
    }
    if (input.action === "report") {
      const state = yield* command({ action: "state", afterSequence: 0 }).pipe(
        Effect.flatMap(decodeState),
        Effect.mapError((error) => (error instanceof UnityHookError ? error : invalid())),
      );
      const document = gameReport(session.catalog, state);
      const reference = yield* html
        .publish({
          threadId: caller.threadId,
          title: "Unity gameplay observations",
          height: 700,
          html: document,
        })
        .pipe(
          Effect.mapError(
            () =>
              new UnityHookError({
                code: "report_failed",
                reason: "Could not publish the gameplay report.",
              }),
          ),
        );
      return { htmlRender: reference, html: document };
    }
    if (input.action === "state")
      return yield* command(input).pipe(
        Effect.flatMap(decodeState),
        Effect.mapError((error) => (error instanceof UnityHookError ? error : invalid())),
      );
    if (input.action === "acquire") {
      const result = yield* command({
        action: "acquire",
        owner: NodeCrypto.createHash("sha256").update(`${token}:${input.sessionId}`).digest("hex"),
        role: caller.role,
        takeover: caller.role === "human" && input.takeover,
      }).pipe(
        Effect.flatMap(decodeLease),
        Effect.mapError((error) => (error instanceof UnityHookError ? error : invalid())),
      );
      session.lease = result.lease;
      return result;
    }
    if ("lease" in input && input.lease !== session.lease)
      return yield* new UnityHookError({
        code: "control_lost",
        reason: "Acquire control before changing gameplay.",
      });
    if (
      input.action === "monitor" &&
      input.notifyAgent &&
      (!input.predicate || notifications.size >= 16)
    )
      return yield* new UnityHookError({
        code: "invalid_monitor",
        reason: "Agent notifications require a predicate; at most 16 notification watches can run.",
      });
    const result = yield* command(input);
    if (input.action === "monitor" && input.notifyAgent) {
      const watch = yield* decodeWatch(result).pipe(Effect.mapError(invalid));
      yield* notifyWatch(caller.threadId, session, watch, input.durationMs);
    }
    if (input.action === "release") delete session.lease;
    return result;
  });
  const agentRequest = Effect.fn("GameSessions.agentRequest")(function* (
    threadId: ThreadId,
    input: GameRequest,
  ) {
    yield* viewer("").pipe(Effect.catch(() => Effect.void));
    let token = agents.get(threadId);
    if (!token) {
      const created = yield* ticket({ cwd: "", threadId, canOperate: true, role: "agent" });
      token = created.token;
      agents.set(threadId, token);
    }
    return yield* request(token, input);
  });
  const agentSnapshot = Effect.fn("GameSessions.agentSnapshot")(function* (
    threadId: ThreadId,
    id: string,
  ) {
    const token = agents.get(threadId) ?? "";
    const session = yield* getSession(token, id);
    // A dormant target starts encoding on demand. Retry only its explicit not-ready response.
    const bytes = yield* transport.frame(session.bridge).pipe(
      Effect.retry({
        schedule: Schedule.spaced("100 millis"),
        times: 10,
        while: (error) => error.code === "bridge_503",
      }),
    );
    const state = yield* request(token, { action: "state", sessionId: id, afterSequence: 0 }).pipe(
      Effect.flatMap(decodeState),
      Effect.mapError((error) => (error instanceof UnityHookError ? error : invalid())),
    );
    const scale = Math.min(1, 1280 / Math.max(state.width, state.height));
    return {
      screenshot: {
        mimeType: "image/jpeg" as const,
        data: Buffer.from(bytes).toString("base64"),
        width: Math.max(1, Math.floor(state.width * scale)),
        height: Math.max(1, Math.floor(state.height * scale)),
      },
    };
  });
  const video = Effect.fn("GameSessions.video")(function* (
    token: string,
    id: string,
    after?: string,
  ) {
    const session = yield* getSession(token, id);
    if (after !== undefined && !/^[0-9]{0,20}$/.test(after))
      return yield* new UnityHookError({
        code: "invalid_request",
        reason: "Invalid frame sequence.",
      });
    return yield* transport.video(session.bridge, after);
  });
  return GameSessions.of({
    video,
    ticket,
    request,
    agentRequest,
    agentSnapshot,
    configuration: (token) =>
      viewer(token).pipe(Effect.map((v) => ({ cwd: v.cwd, canOperate: v.canOperate }))),
    frame: (token, id) =>
      getSession(token, id).pipe(Effect.flatMap((s) => transport.frame(s.bridge))),
  });
});
export const layer = Layer.effect(GameSessions, make);
