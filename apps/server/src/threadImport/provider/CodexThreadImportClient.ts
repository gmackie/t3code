import { resolveSpawnCommand } from "@t3tools/shared/shell";
import * as Effect from "effect/Effect";
import type * as Duration from "effect/Duration";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import { ChildProcess, type ChildProcessSpawner } from "effect/unstable/process";
import * as CodexClient from "effect-codex-app-server/client";
import * as CodexErrors from "effect-codex-app-server/errors";

import { expandHomePath } from "../../pathExpansion.ts";
import { buildCodexInitializeParams } from "../../provider/Layers/CodexProvider.ts";
import type { CodexThreadImportClient } from "./CodexThreadImportSource.ts";

const DEFAULT_IMPORT_REQUEST_TIMEOUT = "30 seconds";

export const withCodexImportTimeout = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  timeout: Duration.Input,
): Effect.Effect<A, E | CodexErrors.CodexAppServerRequestError, R> =>
  effect.pipe(
    Effect.timeoutOption(timeout),
    Effect.flatMap(
      Option.match({
        onNone: () =>
          Effect.fail(
            new CodexErrors.CodexAppServerRequestError({
              code: -32_000,
              errorMessage: "Codex history request timed out.",
            }),
          ),
        onSome: Effect.succeed,
      }),
    ),
  );

/** A short-lived app-server client that initializes RPC but never opens a provider thread. */
export const makeCodexThreadImportClient = (options: {
  readonly spawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly binaryPath: string;
  readonly homePath?: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly requestTimeout?: Duration.Input;
}): CodexThreadImportClient => ({
  rawRequest: (method, payload) =>
    withCodexImportTimeout(
      Effect.scoped(
        Effect.gen(function* () {
          const resolvedHomePath = options.homePath ? expandHomePath(options.homePath) : undefined;
          const env = {
            ...options.environment,
            ...(resolvedHomePath ? { CODEX_HOME: resolvedHomePath } : {}),
          };
          const extendEnv = options.environment === undefined;
          const command = yield* resolveSpawnCommand(options.binaryPath, ["app-server"], {
            env,
            extendEnv,
          });
          const child = yield* options.spawner
            .spawn(
              ChildProcess.make(command.command, command.args, {
                env,
                extendEnv,
                forceKillAfter: "2 seconds",
                shell: command.shell,
              }),
            )
            .pipe(
              Effect.mapError(
                (cause) =>
                  new CodexErrors.CodexAppServerSpawnError({
                    command: `${options.binaryPath} app-server`,
                    cause,
                  }),
              ),
            );
          const clientContext = yield* CodexClient.layerChildProcess(child).pipe(
            Layer.build,
            Effect.provideService(Scope.Scope, yield* Scope.Scope),
          );
          const client = yield* Effect.service(CodexClient.CodexAppServerClient).pipe(
            Effect.provide(clientContext),
          );
          yield* client.request("initialize", buildCodexInitializeParams());
          yield* client.notify("initialized", undefined);
          return yield* client.request(method, payload);
        }),
      ),
      options.requestTimeout ?? DEFAULT_IMPORT_REQUEST_TIMEOUT,
    ),
});
