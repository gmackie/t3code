// @effect-diagnostics nodeBuiltinImport:off - Connection keys use Node's synchronous digest.
import * as NodeCrypto from "node:crypto";

import { mcpServerVariableRecord, type ResolvedMcpServer } from "@t3tools/contracts";
import { MCP_APP_EXTENSION_ID, MCP_APP_MIME_TYPE } from "@t3tools/shared/mcpApp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  type OAuthClientProvider,
  UnauthorizedError,
} from "@modelcontextprotocol/sdk/client/auth.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";

export class McpClientPoolError extends Schema.TaggedError<McpClientPoolError>()(
  "McpClientPoolError",
  {
    server: Schema.String,
    operation: Schema.Literals(["connect", "listTools", "callTool", "readResource"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `MCP server "${this.server}" failed during ${this.operation}.`;
  }
}

/** The server wants a sign-in T3 doesn't have yet; panels show "Sign in" instead of failing. */
export class McpServerNeedsAuthError extends Schema.TaggedError<McpServerNeedsAuthError>()(
  "McpServerNeedsAuthError",
  {
    server: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `MCP server "${this.server}" needs you to sign in.`;
  }
}

export type McpClientPoolFailure = McpClientPoolError | McpServerNeedsAuthError;

const isAuthFailure = (cause: unknown) =>
  cause instanceof UnauthorizedError ||
  (cause instanceof StreamableHTTPError && cause.code === 401);

export interface McpPoolTool {
  readonly name: string;
  readonly _meta?: unknown;
  readonly annotations?: unknown;
}

export interface McpPoolCallToolResult {
  readonly content: ReadonlyArray<unknown>;
  readonly structuredContent?: unknown;
  readonly isError?: boolean;
  readonly _meta?: unknown;
}

/**
 * T3's own connections to Settings → Tools servers, for work that has no
 * provider session, such as rendering a plugin panel. Callers pass a server
 * resolved from settings with secrets materialized; any change to its config
 * selects a new connection, and unused ones close after the idle window.
 */
export class McpClientPool extends Context.Service<
  McpClientPool,
  {
    readonly listTools: (
      server: ResolvedMcpServer,
    ) => Effect.Effect<ReadonlyArray<McpPoolTool>, McpClientPoolFailure>;
    readonly callTool: (
      server: ResolvedMcpServer,
      input: { readonly name: string; readonly arguments: Record<string, unknown> },
    ) => Effect.Effect<McpPoolCallToolResult, McpClientPoolFailure>;
    readonly readResource: (
      server: ResolvedMcpServer,
      uri: string,
    ) => Effect.Effect<{ readonly contents: ReadonlyArray<unknown> }, McpClientPoolFailure>;
    /** Closes every connection to the named server, e.g. when its plugin is disabled. */
    readonly closeServer: (name: string) => Effect.Effect<void>;
  }
>()("t3/mcp/McpClientPool") {}

export interface McpClientPoolOptions {
  readonly idleTimeout?: Duration.Input;
  /** Extra environment for stdio servers the pool spawns, such as T3's callback credentials. */
  readonly stdioEnvironment?: (server: ResolvedMcpServer) => Record<string, string>;
  /** Signs requests to http servers; the SDK runs refresh and reports a missing sign-in. */
  readonly authProvider?: (server: ResolvedMcpServer) => OAuthClientProvider | undefined;
}

const DEFAULT_IDLE_TIMEOUT = Duration.minutes(5);
const CLIENT_INFO = { name: "t3-code", version: "1.0.0" } as const;

interface Entry {
  readonly name: string;
  readonly client: Deferred.Deferred<Client, McpClientPoolFailure>;
  connected: Client | undefined;
  inFlight: number;
  idle: Fiber.Fiber<void> | undefined;
}

const inheritedEnvironment = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );

const failureFor = (
  server: ResolvedMcpServer,
  operation: McpClientPoolError["operation"],
  cause: unknown,
): McpClientPoolFailure =>
  isAuthFailure(cause)
    ? new McpServerNeedsAuthError({ server: server.name, cause })
    : new McpClientPoolError({ server: server.name, operation, cause });

// The key covers secrets, so it is hashed and never logged.
const connectionKey = (server: ResolvedMcpServer): string =>
  NodeCrypto.createHash("sha256").update(JSON.stringify(server)).digest("hex");

const transportFor = (server: ResolvedMcpServer, options: McpClientPoolOptions) => {
  const { transport } = server;
  if (transport.type === "stdio") {
    return new StdioClientTransport({
      command: transport.command,
      args: [...transport.args],
      // Inherit the server's environment as provider CLIs do, so the pool's copy and
      // the session copies agree on HOME and XDG_STATE_HOME and can share state.
      env: {
        ...inheritedEnvironment(),
        ...mcpServerVariableRecord(transport.env),
        ...options.stdioEnvironment?.(server),
      },
      // Server stderr can echo secrets from its environment, so it isn't forwarded.
      stderr: "ignore",
    });
  }
  const authProvider = options.authProvider?.(server);
  return new StreamableHTTPClientTransport(new URL(transport.url), {
    requestInit: { headers: mcpServerVariableRecord(transport.headers) },
    ...(authProvider ? { authProvider } : {}),
  });
};

const make = Effect.fn("McpClientPool.make")(function* (options: McpClientPoolOptions = {}) {
  const idleTimeout = Duration.fromInputUnsafe(options.idleTimeout ?? DEFAULT_IDLE_TIMEOUT);
  const entries = new Map<string, Entry>();
  const lock = yield* Semaphore.make(1);
  const fibers = yield* Scope.make("sequential");

  const closeClient = (client: Client) =>
    Effect.promise(() => client.close()).pipe(Effect.ignoreCause({ log: true }));

  const drop = Effect.fnUntraced(function* (key: string, entry: Entry) {
    if (entries.get(key) !== entry) return;
    entries.delete(key);
    if (entry.idle) yield* Fiber.interrupt(entry.idle);
    if (entry.connected) yield* closeClient(entry.connected);
  });

  const connect = (server: ResolvedMcpServer, key: string, entry: Entry) =>
    Effect.tryPromise({
      try: async () => {
        const client = new Client(CLIENT_INFO, {
          capabilities: {
            extensions: { [MCP_APP_EXTENSION_ID]: { mimeTypes: [MCP_APP_MIME_TYPE] } },
          },
        });
        // The SDK's transport classes predate exactOptionalPropertyTypes.
        await client.connect(transportFor(server, options) as Transport);
        return client;
      },
      catch: (cause) => failureFor(server, "connect", cause),
    }).pipe(
      Effect.tap((client) =>
        Effect.sync(() => {
          entry.connected = client;
          // A crashed process or dropped session reconnects on the next request.
          client.onclose = () => {
            if (entries.get(key) === entry) entries.delete(key);
          };
        }),
      ),
      Effect.exit,
      Effect.flatMap((exit) =>
        Deferred.done(entry.client, exit).pipe(
          // Waiters see the failure; the next request starts a fresh connection.
          Effect.andThen(
            Exit.isFailure(exit) ? lock.withPermits(1)(drop(key, entry)) : Effect.void,
          ),
        ),
      ),
    );

  const acquire = Effect.fnUntraced(function* (server: ResolvedMcpServer) {
    const key = connectionKey(server);
    const entry = yield* lock.withPermits(1)(
      Effect.gen(function* () {
        let current = entries.get(key);
        if (!current) {
          current = {
            name: server.name,
            client: yield* Deferred.make<Client, McpClientPoolFailure>(),
            connected: undefined,
            inFlight: 0,
            idle: undefined,
          };
          entries.set(key, current);
          yield* connect(server, key, current).pipe(Effect.forkIn(fibers));
        }
        current.inFlight += 1;
        if (current.idle) {
          yield* Fiber.interrupt(current.idle);
          current.idle = undefined;
        }
        return current;
      }),
    );
    return { key, entry };
  });

  const release = (key: string, entry: Entry) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        entry.inFlight -= 1;
        if (entry.inFlight > 0 || entries.get(key) !== entry) return;
        entry.idle = yield* Effect.sleep(idleTimeout).pipe(
          Effect.andThen(
            lock.withPermits(1)(
              Effect.suspend(() => {
                // Clear first so drop doesn't interrupt this fiber.
                entry.idle = undefined;
                return drop(key, entry);
              }),
            ),
          ),
          Effect.forkIn(fibers),
        );
      }),
    );

  const withClient = <A>(
    server: ResolvedMcpServer,
    operation: McpClientPoolError["operation"],
    use: (client: Client) => Promise<A>,
  ): Effect.Effect<A, McpClientPoolFailure> =>
    Effect.acquireUseRelease(
      acquire(server),
      ({ key, entry }) =>
        Deferred.await(entry.client).pipe(
          Effect.flatMap((client) =>
            Effect.tryPromise({
              try: () => use(client),
              catch: (cause) => failureFor(server, operation, cause),
            }).pipe(
              // A revoked sign-in drops the connection so the next request starts clean.
              Effect.tapError((error) =>
                error._tag === "McpServerNeedsAuthError"
                  ? lock.withPermits(1)(drop(key, entry))
                  : Effect.void,
              ),
            ),
          ),
        ),
      ({ key, entry }) => release(key, entry),
    );

  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      yield* Scope.close(fibers, Exit.void);
      const clients = [...entries.values()].flatMap((entry) => entry.connected ?? []);
      entries.clear();
      yield* Effect.forEach(clients, closeClient, { concurrency: "unbounded", discard: true });
    }),
  );

  return McpClientPool.of({
    listTools: Effect.fn("McpClientPool.listTools")(function* (server) {
      const result = yield* withClient(server, "listTools", (client) => client.listTools());
      return result.tools;
    }),
    callTool: Effect.fn("McpClientPool.callTool")(function* (server, input) {
      const result = yield* withClient(server, "callTool", (client) =>
        client.callTool({ name: input.name, arguments: input.arguments }),
      );
      return {
        content: Array.isArray(result.content) ? result.content : [],
        ...(result.structuredContent === undefined
          ? {}
          : { structuredContent: result.structuredContent }),
        ...(result.isError === true ? { isError: true } : {}),
        ...(result._meta === undefined ? {} : { _meta: result._meta }),
      };
    }),
    readResource: Effect.fn("McpClientPool.readResource")(function* (server, uri) {
      const result = yield* withClient(server, "readResource", (client) =>
        client.readResource({ uri }),
      );
      return { contents: result.contents };
    }),
    closeServer: Effect.fn("McpClientPool.closeServer")(function* (name) {
      yield* lock.withPermits(1)(
        Effect.forEach(
          [...entries].filter(([, entry]) => entry.name === name),
          ([key, entry]) => drop(key, entry),
          { discard: true },
        ),
      );
    }),
  });
});

export const layerWith = (options: McpClientPoolOptions) =>
  Layer.effect(McpClientPool, make(options));

export const layer = layerWith({});
