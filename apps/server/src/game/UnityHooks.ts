import {
  UnityBridgeConnection,
  UnityCommandRequest,
  UnityCommandResult,
  type UnityTarget,
  UnityHookAssertion,
  UnityHookCatalog,
  UnityHookError,
  UnityHookRequest,
  UnityHookResult,
  UnityHookSample,
  UnityHookWatch,
} from "@t3tools/contracts";
import * as NodeCrypto from "node:crypto";
import * as ServerConfig from "../config.ts";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { resolveBaseDir } from "../os-jank.ts";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as ProcessRunner from "../processRunner.ts";

export class UnityHooks extends Context.Service<
  UnityHooks,
  {
    readonly command: (
      request: UnityCommandRequest,
    ) => Effect.Effect<UnityCommandResult, UnityHookError>;
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
const decodeCommandRequest = Schema.decodeUnknownEffect(UnityCommandRequest);
const decodeCommandResult = Schema.decodeUnknownEffect(UnityCommandResult);
const decodeReceipt = Schema.decodeUnknownEffect(Schema.fromJsonString(UnityCommandResult));

const make = Effect.gen(function* () {
  const runner = yield* ProcessRunner.ProcessRunner;
  const executable = yield* Config.String("T3CODE_UNITY_CLI").pipe(Config.withDefault("unity"));
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverConfig = yield* Effect.serviceOption(ServerConfig.ServerConfig);
  const stateDirName = yield* Config.String("T3CODE_STATE_DIR_NAME").pipe(Config.option);
  const stateDir = Option.isSome(serverConfig)
    ? serverConfig.value.stateDir
    : (yield* ServerConfig.deriveServerPaths(
        yield* resolveBaseDir(
          Option.getOrUndefined(yield* Config.String("T3CODE_HOME").pipe(Config.option)),
        ),
        undefined,
        Option.isSome(stateDirName) ? { stateDirName: stateDirName.value } : {},
      )).stateDir;
  const receiptPath = (canonical: string, target: UnityTarget, jobId: string) =>
    path.join(
      stateDir,
      "unity-jobs",
      NodeCrypto.createHash("sha256").update(`${target.kind}:${canonical}`).digest("hex"),
      `${jobId}.json`,
    );
  const recover = Effect.fn("UnityHooks.recover")(function* (
    canonical: string,
    request: UnityCommandRequest,
  ) {
    if (request.action !== "status") return undefined;
    return yield* fs.readFileString(receiptPath(canonical, request.target, request.jobId)).pipe(
      Effect.flatMap(decodeReceipt),
      Effect.map((result) =>
        result.action === "job" &&
        result.jobId === request.jobId &&
        ["completed", "failed", "canceled"].includes(result.state)
          ? { ...result, recovered: true }
          : undefined,
      ),
      Effect.catch(() => Effect.succeed(undefined)),
    );
  });
  const runCli = Effect.fn("UnityHooks.runCli")(function* (
    args: string[],
    phase: string,
    jobId?: string,
  ) {
    const output = yield* runner
      .run({
        command: executable,
        args,
        timeout: "20 seconds",
        maxOutputBytes: 2 * 1024 * 1024,
        outputMode: "truncate",
        timeoutBehavior: "timedOutResult",
      })
      .pipe(
        Effect.mapError(
          (error) =>
            new UnityHookError({
              code: error._tag,
              reason: `Unity CLI failed during ${phase}. ${jobId ? `Recover job ${jobId} with status;` : "Inspect the target;"} do not repeat a mutation with an unknown outcome.`,
              diagnostics: {
                phase,
                exitCode: null,
                timedOut: false,
                truncated: false,
                stderr: "",
                ...(jobId ? { jobId } : {}),
                outcome: "unknown",
              },
            }),
        ),
      );
    let value: unknown;
    try {
      value = JSON.parse(output.stdout);
    } catch {
      /* The transport diagnostic below owns incomplete JSON. */
    }
    if (
      !jobId &&
      record(value) &&
      record(value.data) &&
      typeof value.data.jobId === "string" &&
      /^[A-Za-z0-9_-]{1,128}$/.test(value.data.jobId)
    )
      jobId = value.data.jobId;
    const diagnostics = {
      phase,
      exitCode: output.code,
      timedOut: output.timedOut,
      truncated: output.stdoutTruncated || output.stderrTruncated,
      stderr: output.stderr.slice(-2048),
      ...(jobId ? { jobId } : {}),
      outcome: "unknown" as const,
    };
    if (
      record(value) &&
      value.success === false &&
      !output.timedOut &&
      !output.stdoutTruncated &&
      !output.stdoutInvalidUtf8
    ) {
      const entry = Array.isArray(value.errors) ? value.errors[0] : value.error;
      const error = record(entry) ? entry : undefined;
      const message =
        typeof error?.message === "string"
          ? error.message.slice(0, 1200)
          : "Unity rejected the command.";
      const stopped =
        /No Pipeline instance found|no running.*instance|Cannot connect to Pipeline server/i.test(
          message,
        );
      const missingJob = /Job Not Found/i.test(message);
      return yield* new UnityHookError({
        code: stopped
          ? "target_unavailable"
          : missingJob
            ? "job_unavailable"
            : typeof error?.code === "string"
              ? error.code
              : "command_failed",
        reason: stopped
          ? "No running Pipeline instance for this target. Start its pinned Unity Editor or development Player, then retry discovery."
          : missingJob
            ? `Unity no longer retains job ${jobId ?? "requested"}. Its outcome is unknown (domain reload or retention). Do not resubmit the mutation blindly.`
            : message,
        diagnostics: {
          ...diagnostics,
          outcome:
            stopped || /Command Not Found|Bad Request/.test(message) ? "rejected" : "unknown",
        },
      });
    }
    if (
      output.code !== 0 ||
      output.timedOut ||
      output.stdoutTruncated ||
      output.stdoutInvalidUtf8 ||
      value === undefined
    )
      return yield* new UnityHookError({
        code: "cli_incomplete",
        reason: `Unity CLI response is incomplete during ${phase} (exit ${output.code ?? "unknown"}${output.timedOut ? ", timed out" : ""}). ${jobId ? `Retry status for job ${jobId};` : "Inspect Unity before retrying;"} do not repeat a mutation with an unknown outcome.`,
        diagnostics,
      });
    return { output, value };
  });
  const resolveTarget = Effect.fn("UnityHooks.resolveTarget")(function* (target: UnityTarget) {
    const targetPath = target.kind === "editor" ? target.projectPath : target.portFile;
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
      target.kind === "editor" &&
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
    if (target.kind === "player" && path.basename(canonical) !== ".unity-pipeline-runtime-port")
      return yield* new UnityHookError({
        code: "invalid_target",
        reason: "Select the Player's .unity-pipeline-runtime-port file.",
      });
    return canonical;
  });
  const invoke = Effect.fn("UnityHooks.invoke")(function* (raw: UnityHookRequest, connect = false) {
    const request = yield* decodeRequest(raw).pipe(
      Effect.mapError(
        () =>
          new UnityHookError({ code: "invalid_request", reason: "Invalid Unity hook request." }),
      ),
    );
    const canonical = yield* resolveTarget(request.target);
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
    if (request.action === "watch" && request.predicate)
      args.push("--predicate", JSON.stringify(request.predicate));
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
    const canonical = yield* resolveTarget(target);
    const targetArgs = [
      target.kind === "editor" ? "--project-path" : "--runtime-path",
      target.kind === "player" ? path.dirname(canonical) : canonical,
      "--json",
      "--no-banner",
      "--non-interactive",
    ];
    const { value: catalog } = yield* runCli(
      [
        "command",
        "--detail",
        "full",
        "--query",
        "agent_game_capabilities",
        "--offset",
        "0",
        "--limit",
        "100",
        ...targetArgs,
      ],
      "capabilities",
    );
    if (!record(catalog) || !record(catalog.data) || !Array.isArray(catalog.data.commands))
      return yield* new UnityHookError({
        code: "invalid_response",
        reason: "Unity returned no capability catalog.",
      });
    if (
      !catalog.data.commands.some(
        (entry) => record(entry) && entry.name === "agent_game_capabilities",
      )
    )
      return yield* new UnityHookError({
        code: "integration_unavailable",
        reason:
          "Pipeline is running, but this target lacks the T3 Game Bridge capability handshake. Install com.gmacko.pipeline.game 0.2.0 or newer with matching com.gmacko.pipeline runtime hooks, let Unity compile, and rebuild development Players. Regular Pipeline commands remain available.",
      });
    const { output } = yield* runCli(
      ["command", "agent_game_capabilities", ...targetArgs],
      "capabilities",
    );
    const capabilities = yield* Effect.try({
      try: () => payload(output.stdout),
      catch: () =>
        new UnityHookError({
          code: "invalid_capabilities",
          reason: "Unity returned an invalid Game Bridge capability response.",
        }),
    });
    if (!record(capabilities) || capabilities.protocol !== 1 || capabilities.target !== target.kind)
      return yield* new UnityHookError({
        code: "incompatible_integration",
        reason:
          "This target's Game Bridge protocol is incompatible. Update com.gmacko.pipeline.game and rebuild the development Player.",
      });
    const features = capabilities.features;
    if (
      !Array.isArray(features) ||
      !["frames", "input", "hooks"].every((feature) => features.includes(feature))
    )
      return yield* new UnityHookError({
        code: "incompatible_integration",
        reason:
          "This target lacks required frame, input, or hook features. Update both GMacko Pipeline and Game Bridge packages.",
      });
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
  const command = Effect.fn("UnityHooks.command")(function* (raw: UnityCommandRequest) {
    const request = yield* decodeCommandRequest(raw).pipe(
      Effect.mapError(
        () =>
          new UnityHookError({ code: "invalid_request", reason: "Invalid Unity command request." }),
      ),
    );
    if (
      request.action === "submit" &&
      (Object.keys(request.parameters).length > 64 ||
        JSON.stringify(request.parameters).length > 131072)
    )
      return yield* new UnityHookError({
        code: "invalid_request",
        reason: "Unity commands accept at most 64 parameters and 128 KiB of parameter text.",
      });
    const canonical = yield* resolveTarget(request.target);
    const args =
      request.action === "catalog"
        ? [
            "command",
            "--detail",
            "full",
            "--offset",
            String(request.offset),
            "--limit",
            String(request.limit),
          ]
        : request.action === "submit"
          ? ["command", request.command, "--detach"]
          : ["job", request.action, request.jobId];
    if (request.action === "catalog" && request.query) args.push("--query", request.query);
    args.push(
      request.target.kind === "editor" ? "--project-path" : "--runtime-path",
      request.target.kind === "player" ? path.dirname(canonical) : canonical,
      "--json",
      "--no-banner",
      "--non-interactive",
    );
    if (request.action === "submit") {
      // Commander stops parsing global target/transport flags at this boundary.
      // Game command parameters cannot redirect an invocation to another target.
      args.push("--");
      for (const [key, value] of Object.entries(request.parameters))
        args.push(`--${key}`, String(value));
    }
    const cached = yield* recover(canonical, request);
    if (cached) return cached;
    const { value: envelope } = yield* runCli(
      args,
      request.action,
      "jobId" in request ? request.jobId : undefined,
    );
    if (!record(envelope) || envelope.success !== true || !record(envelope.data))
      return yield* new UnityHookError({
        code: "command_failed",
        reason: "Unity rejected the command. Inspect the target before retrying.",
      });
    const data = envelope.data;
    if (request.action === "catalog") {
      if (!Array.isArray(data.commands))
        return yield* new UnityHookError({
          code: "invalid_response",
          reason: "Unity returned no command catalog.",
        });
      // Enforce our response bound even with older CLIs that ignore listing options.
      const commands = data.commands;
      return {
        action: "catalog" as const,
        commands: commands.slice(0, request.limit),
        offset: request.offset,
      };
    }
    const result = yield* decodeCommandResult({ ...data, action: "job" }).pipe(
      Effect.mapError(
        () =>
          new UnityHookError({
            code: "invalid_response",
            reason: "Unity returned an incompatible job result.",
          }),
      ),
    );
    if (result.action === "job" && "jobId" in request && result.jobId !== request.jobId)
      return yield* new UnityHookError({
        code: "wrong_job",
        reason:
          "Unity returned a different job ID. The requested job's outcome is unknown; do not resubmit its mutation.",
      });
    if (result.action === "job" && ["completed", "failed", "canceled"].includes(result.state)) {
      const file = receiptPath(canonical, request.target, result.jobId);
      const directory = path.dirname(file);
      const temporary = `${file}.${NodeCrypto.randomUUID()}.tmp`;
      // Only persist observed terminal results; interrupted/queued work is never replayed.
      yield* Effect.gen(function* () {
        yield* fs.makeDirectory(directory, { recursive: true });
        yield* fs.writeFileString(temporary, JSON.stringify(result), { mode: 0o600 });
        yield* fs.rename(temporary, file);
        const entries = yield* fs.readDirectory(directory);
        const receipts = yield* Effect.forEach(
          entries.filter((name) => /^[A-Za-z0-9_-]+\.json$/.test(name)),
          (name) =>
            fs.stat(path.join(directory, name)).pipe(
              Effect.map((stat) => ({
                name,
                modified: stat.mtime._tag === "Some" ? stat.mtime.value.getTime() : 0,
              })),
            ),
          { concurrency: 1 },
        );
        receipts.sort((a, b) => b.modified - a.modified);
        yield* Effect.forEach(
          receipts.slice(100).filter((entry) => entry.name !== path.basename(file)),
          (entry) => fs.remove(path.join(directory, entry.name)),
          { discard: true },
        );
      }).pipe(
        Effect.catch(() =>
          Effect.logWarning(
            `Could not retain Unity receipt ${result.jobId}; the current response still contains the engine result.`,
          ),
        ),
        Effect.ensuring(fs.remove(temporary).pipe(Effect.ignore)),
      );
    }
    return result;
  });
  return UnityHooks.of({ execute, connect, command });
});
export const layer = Layer.effect(UnityHooks, make);
