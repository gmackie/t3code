import {
  UnityBridgeConnection,
  type UnityTarget,
  UnityHookAssertion,
  UnityHookCatalog,
  UnityHookError,
  UnityHookRequest,
  UnityHookResult,
  UnityHookSample,
  UnityHookWatch,
} from "@t3tools/contracts";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as ProcessRunner from "../processRunner.ts";

export class UnityHooks extends Context.Service<
  UnityHooks,
  {
    readonly connect: (target: UnityTarget) => Effect.Effect<UnityBridgeConnection, UnityHookError>;
    readonly execute: (request: UnityHookRequest) => Effect.Effect<UnityHookResult, UnityHookError>;
  }
>()("t3/game/UnityHooks") {}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Unwrap only CLI/Pipeline transport fields, never recurse through gameplay data. */
function payload(output: string): unknown {
  let value: unknown = JSON.parse(output);
  for (let depth = 0; depth < 8; depth++) {
    if (!record(value)) break;
    if (value.ok === false || value.success === false) {
      const firstError = Array.isArray(value.errors) ? value.errors[0] : undefined;
      const error = record(value.error) ? value.error : record(firstError) ? firstError : undefined;
      throw new UnityHookError({
        code: typeof error?.code === "string" ? error.code : "command_failed",
        reason:
          typeof error?.message === "string" ? error.message : "Unity rejected the hook command.",
      });
    }
    if (value.ok === true) return value.data;
    if ("result" in value) value = value.result;
    else if ("data" in value) value = value.data;
    else break;
  }
  throw new UnityHookError({
    code: "invalid_response",
    reason: "Unity returned no structured hook result.",
  });
}

const decodeBridge = Schema.decodeUnknownEffect(UnityBridgeConnection);
const decodeRequest = Schema.decodeUnknownEffect(UnityHookRequest);

const make = Effect.gen(function* () {
  const runner = yield* ProcessRunner.ProcessRunner;
  const executable = yield* Config.String("T3CODE_UNITY_CLI").pipe(Config.withDefault("unity"));
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const invoke = Effect.fn("UnityHooks.invoke")(function* (raw: UnityHookRequest, connect = false) {
    const request = yield* decodeRequest(raw).pipe(
      Effect.mapError(
        () =>
          new UnityHookError({ code: "invalid_request", reason: "Invalid Unity hook request." }),
      ),
    );
    const targetPath =
      request.target.kind === "editor" ? request.target.projectPath : request.target.portFile;
    if (!path.isAbsolute(targetPath))
      return yield* new UnityHookError({
        code: "invalid_target",
        reason: "Use an absolute Unity project path or Player port-file path.",
      });
    const canonical = yield* fs.realPath(targetPath).pipe(
      Effect.mapError(
        () =>
          new UnityHookError({
            code: "target_missing",
            reason: "The Unity target path does not exist on this environment.",
          }),
      ),
    );
    if (
      request.target.kind === "editor" &&
      !(yield* fs.exists(path.join(canonical, "ProjectSettings", "ProjectVersion.txt")).pipe(
        Effect.mapError(
          () =>
            new UnityHookError({
              code: "target_unreadable",
              reason: "Cannot inspect the Unity project.",
            }),
        ),
      ))
    )
      return yield* new UnityHookError({
        code: "invalid_target",
        reason: "Select the Unity project root containing ProjectSettings/ProjectVersion.txt.",
      });
    if (
      request.target.kind === "player" &&
      path.basename(canonical) !== ".unity-pipeline-runtime-port"
    )
      return yield* new UnityHookError({
        code: "invalid_target",
        reason: "Select the Player's .unity-pipeline-runtime-port file.",
      });
    const args = ["command", connect ? "agent_game_connect" : `agent_vars_${request.action}`];
    if ("generation" in request) args.push("--generation", request.generation);
    if ("handles" in request) args.push("--handles", JSON.stringify(request.handles));
    if ("handle" in request) args.push("--handle", request.handle);
    if ("value" in request) args.push("--value", JSON.stringify(request.value));
    if ("expected" in request) args.push("--expected", JSON.stringify(request.expected));
    if (request.action === "watch")
      args.push(
        "--duration_ms",
        String(request.durationMs),
        "--interval_ms",
        String(request.intervalMs),
      );
    if ("id" in request) args.push("--id", request.id);
    if (request.action === "watch_read")
      args.push("--after_sequence", String(request.afterSequence));
    if (request.action === "watch_stop" && request.forget) args.push("--forget");
    args.push(
      request.target.kind === "editor" ? "--project-path" : "--runtime-path",
      request.target.kind === "player" ? path.dirname(canonical) : canonical,
      "--timeout",
      "15",
      "--format",
      "json",
      "--no-banner",
      "--non-interactive",
    );
    const output = yield* runner
      .run({
        command: executable,
        args,
        timeout: "20 seconds",
        maxOutputBytes: 12 * 1024 * 1024,
        outputMode: "error",
      })
      .pipe(
        Effect.mapError(
          (error) =>
            new UnityHookError({
              code: error._tag,
              reason:
                "Unity CLI invocation failed. A timed-out write may already have applied; read before retrying.",
            }),
        ),
      );
    const data = yield* Effect.try({
      try: () => payload(output.stdout),
      catch: (error) =>
        error instanceof UnityHookError
          ? error
          : new UnityHookError({
              code: "invalid_response",
              reason: "Unity CLI did not return valid JSON.",
            }),
    });
    if (output.code !== 0 || output.timedOut || output.stdoutTruncated || output.stdoutInvalidUtf8)
      return yield* new UnityHookError({
        code: "command_failed",
        reason: "Unity CLI did not finish successfully; read state before retrying a write.",
      });
    return { request, data };
  });
  const connect = Effect.fn("UnityHooks.connect")(function* (target: UnityTarget) {
    const { data } = yield* invoke({ action: "list", target }, true);
    return yield* decodeBridge(data).pipe(
      Effect.mapError(
        () =>
          new UnityHookError({
            code: "invalid_bridge",
            reason: "Install GMacko Game Bridge in the Unity project and enter Play Mode.",
          }),
      ),
    );
  });
  const execute = Effect.fn("UnityHooks.execute")(function* (raw: UnityHookRequest) {
    const { request, data } = yield* invoke(raw);
    const schema =
      request.action === "list"
        ? UnityHookCatalog
        : request.action === "assert"
          ? UnityHookAssertion
          : request.action.startsWith("watch")
            ? UnityHookWatch
            : UnityHookSample;
    const result = yield* Schema.decodeUnknownEffect(schema)(data).pipe(
      Effect.mapError(
        () =>
          new UnityHookError({
            code: "invalid_response",
            reason: "Unity returned an incompatible hook result.",
          }),
      ),
    );
    const generation = "generation" in result ? result.generation : result.sample.generation;
    if ("generation" in request && generation !== request.generation)
      return yield* new UnityHookError({
        code: "stale_generation",
        reason: "Unity target changed during the command; discover hooks again.",
      });
    if ("target" in result && result.target !== request.target.kind)
      return yield* new UnityHookError({
        code: "wrong_target",
        reason: "Unity returned a different target kind.",
      });
    return result;
  });
  return UnityHooks.of({ execute, connect });
});
export const layer = Layer.effect(UnityHooks, make);
