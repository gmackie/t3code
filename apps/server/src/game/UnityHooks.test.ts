import { it } from "@effect/vitest";
import { expect } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { ExitCode } from "effect/process/ChildProcessSpawner";
import type { UnityHookRequest } from "@t3tools/contracts";
import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as UnityHooks from "./UnityHooks.ts";

const sample = { generation: "generation-1", sequence: 1, sampledAtMs: 10, values: { handle: 4 } };
const target = { kind: "editor", projectPath: "/tmp/Unity fixture" } as const;
const request = {
  target,
  action: "read",
  generation: "generation-1",
  handles: ["handle"],
} as const;
const envelope = (data: unknown) =>
  JSON.stringify({ success: true, data: { result: { ok: true, data } } });

it.effect("submits detached jobs with command parameters isolated from target flags", () =>
  Effect.gen(function* () {
    const calls: ProcessRunner.ProcessRunInput[] = [];
    const service = yield* UnityHooks.UnityHooks.pipe(
      Effect.provide(
        layer(
          JSON.stringify({
            success: true,
            data: { jobId: "job1", state: "queued", detached: true },
          }),
          calls,
        ),
      ),
    );
    const result = yield* service.command({
      action: "submit",
      target,
      command: "respawn",
      parameters: { "project-path": "/other", message: "$(touch /tmp/nope)" },
    });
    expect(result).toMatchObject({ action: "job", state: "queued" });
    expect(calls[0]?.args).toEqual([
      "command",
      "respawn",
      "--detach",
      "--project-path",
      target.projectPath,
      "--json",
      "--no-banner",
      "--non-interactive",
      "--",
      "--project-path",
      "/other",
      "--message",
      "$(touch /tmp/nope)",
    ]);
  }),
);

it.effect("retains completion and engine failure when cancellation was only requested", () =>
  Effect.gen(function* () {
    const calls: ProcessRunner.ProcessRunInput[] = [];
    const data = {
      jobId: "job1",
      state: "completed",
      cancellationRequested: true,
      result: { success: false, error: "Compile failed" },
    };
    const service = yield* UnityHooks.UnityHooks.pipe(
      Effect.provide(layer(JSON.stringify({ success: true, data }), calls)),
    );
    expect(yield* service.command({ action: "cancel", target, jobId: "job1" })).toEqual({
      action: "job",
      ...data,
    });
    expect(calls[0]?.args?.slice(0, 3)).toEqual(["job", "cancel", "job1"]);
  }),
);

it.effect("rejects missing targets and malformed job responses", () =>
  Effect.gen(function* () {
    const calls: ProcessRunner.ProcessRunInput[] = [];
    const service = yield* UnityHooks.UnityHooks.pipe(Effect.provide(layer("{}", calls)));
    expect(
      (yield* service
        .command({
          action: "status",
          target: { kind: "editor", projectPath: "relative" },
          jobId: "job1",
        })
        .pipe(Effect.flip)).code,
    ).toBe("invalid_target");
    expect(calls).toHaveLength(0);
    expect(
      (yield* service.command({ action: "status", target, jobId: "job1" }).pipe(Effect.flip)).code,
    ).toBe("command_failed");
  }),
);
function layer(
  stdout: string | ((input: ProcessRunner.ProcessRunInput) => string),
  calls: ProcessRunner.ProcessRunInput[],
  code = 0,
  files = new Map<string, string>(),
  overrides: Partial<ProcessRunner.ProcessRunOutput> = {},
) {
  return UnityHooks.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(ProcessRunner.ProcessRunner, {
          run: (input) => {
            calls.push(input);
            return Effect.succeed({
              stdout: typeof stdout === "function" ? stdout(input) : stdout,
              stderr: "",
              code: ExitCode(code),
              timedOut: false,
              stdoutTruncated: false,
              stderrTruncated: false,
              stdoutInvalidUtf8: false,
              stderrInvalidUtf8: false,
              ...overrides,
            });
          },
        }),
        FileSystem.layerNoop({
          realPath: (path) => Effect.succeed(path),
          exists: () => Effect.succeed(true),
          makeDirectory: () => Effect.void,
          rename: (from, to) =>
            Effect.sync(() => {
              const value = files.get(from);
              if (value !== undefined) {
                files.set(to, value);
                files.delete(from);
              }
            }),
          readDirectory: () => Effect.succeed([]),
          remove: (path) =>
            Effect.sync(() => {
              files.delete(path);
            }),
          readFileString: (path) => Effect.succeed(files.get(path) ?? ""),
          writeFileString: (path, text) =>
            Effect.sync(() => {
              files.set(path, text);
            }),
        }),
        Path.layer,
        Layer.succeed(ServerConfig.ServerConfig, {
          stateDir: "/tmp/t3-unity-test-state",
        } as ServerConfig.ServerConfig["Service"]),
      ),
    ),
  );
}

it.effect("pins Editor and Player calls explicitly and returns observed values", () =>
  Effect.gen(function* () {
    const calls: ProcessRunner.ProcessRunInput[] = [];
    const service = yield* UnityHooks.UnityHooks.pipe(
      Effect.provide(layer(envelope(sample), calls)),
    );
    expect(yield* service.execute(request)).toEqual(sample);
    expect(calls[0]?.args).toContain("/tmp/Unity fixture");
    expect(calls[0]?.args).toContain("--project-path");
    yield* service.execute({
      ...request,
      target: { kind: "player", portFile: "/tmp/player/.unity-pipeline-runtime-port" },
    });
    expect(calls[1]?.args).toContain("--runtime-path");
    expect(calls[1]?.args).not.toContain("--project-path");
  }),
);

it.effect("preserves JSON scalar types and expected values as separate argv entries", () =>
  Effect.gen(function* () {
    const calls: ProcessRunner.ProcessRunInput[] = [];
    const service = yield* UnityHooks.UnityHooks.pipe(
      Effect.provide(layer(envelope(sample), calls)),
    );
    yield* service.execute({
      target,
      action: "write",
      generation: "generation-1",
      handle: "handle",
      value: "$(touch /tmp/nope)",
      expected: false,
    });
    expect(calls[0]?.args).toContain('"$(touch /tmp/nope)"');
    expect(calls[0]?.args).toContain("false");
    expect(calls[0]?.command).toBe("unity");
  }),
);

it.effect.each([
  ["malformed", "not-json", 0, "invalid_response"],
  [
    "getter failure",
    JSON.stringify({
      success: true,
      data: { ok: false, error: { code: "read_failed", message: "Getter failed." } },
    }),
    0,
    "read_failed",
  ],
  [
    "stale generation",
    envelope({ ...sample, generation: "new-generation" }),
    0,
    "stale_generation",
  ],
  ["wrong result", envelope({ passed: true, sample }), 0, "invalid_response"],
  ["failed process", envelope(sample), 1, "command_failed"],
] as const)("rejects %s without retrying", ([, stdout, code, expected]) =>
  Effect.gen(function* () {
    const calls: ProcessRunner.ProcessRunInput[] = [];
    const service = yield* UnityHooks.UnityHooks.pipe(Effect.provide(layer(stdout, calls, code)));
    const error = yield* service.execute(request).pipe(Effect.flip);
    expect(error.code).toBe(expected);
    expect(calls).toHaveLength(1);
  }),
);

it.effect("rejects invalid watch bounds and relative target paths before spawning", () =>
  Effect.gen(function* () {
    const calls: ProcessRunner.ProcessRunInput[] = [];
    const service = yield* UnityHooks.UnityHooks.pipe(
      Effect.provide(layer(envelope(sample), calls)),
    );
    const invalid: UnityHookRequest = {
      target,
      action: "watch",
      generation: "generation-1",
      handles: ["handle"],
      durationMs: 60001,
      intervalMs: 0,
    };
    expect((yield* service.execute(invalid).pipe(Effect.flip)).code).toBe("invalid_request");
    expect(
      (yield* service
        .execute({ ...request, target: { kind: "editor", projectPath: "relative" } })
        .pipe(Effect.flip)).code,
    ).toBe("invalid_target");
    expect(calls).toHaveLength(0);
  }),
);

it.effect("bounds catalog output and keeps pagination pinned to the chosen target", () =>
  Effect.gen(function* () {
    const calls: ProcessRunner.ProcessRunInput[] = [];
    const service = yield* UnityHooks.UnityHooks.pipe(
      Effect.provide(
        layer(
          JSON.stringify({
            success: true,
            data: { commands: [{ name: "damage" }, { name: "respawn" }] },
          }),
          calls,
        ),
      ),
    );
    expect(
      yield* service.command({ action: "catalog", target, query: "game", offset: 5, limit: 1 }),
    ).toEqual({ action: "catalog", offset: 5, commands: [{ name: "damage" }] });
    expect(calls[0]?.args).toContain("--offset");
    expect(calls[0]?.args).toContain("5");
  }),
);

it.effect("passes typed watch predicates and explicit rearm to the selected Unity target", () =>
  Effect.gen(function* () {
    const calls: ProcessRunner.ProcessRunInput[] = [];
    const predicate = { handle: "handle", operator: "lt", expected: 5 } as const;
    const watch = {
      id: "watch",
      generation: "generation-1",
      status: "active",
      error: null,
      dropped: 0,
      samples: [sample],
      predicate,
      armed: false,
      receipts: [{ id: "receipt", arm: 1, sample }],
    };
    const service = yield* UnityHooks.UnityHooks.pipe(
      Effect.provide(layer(envelope(watch), calls)),
    );
    expect(
      yield* service.execute({
        action: "watch",
        target,
        generation: "generation-1",
        handles: ["handle"],
        durationMs: 1000,
        intervalMs: 100,
        predicate,
      }),
    ).toEqual(watch);
    expect(calls[0]?.args).toContain(JSON.stringify(predicate));
    expect(
      yield* service.execute({
        action: "watch_rearm",
        target,
        generation: "generation-1",
        id: "watch",
      }),
    ).toEqual(watch);
    expect(calls[1]?.args?.slice(0, 2)).toEqual(["command", "agent_vars_watch_rearm"]);
  }),
);

it.effect("preserves a nonzero CLI rejection and its transport diagnostics", () =>
  Effect.gen(function* () {
    const calls: ProcessRunner.ProcessRunInput[] = [];
    const service = yield* UnityHooks.UnityHooks.pipe(
      Effect.provide(
        layer(
          JSON.stringify({
            success: false,
            errors: [
              { code: "COMMAND_FAILED", message: "Bad Request: invalid command parameters" },
            ],
          }),
          calls,
          6,
          undefined,
          { stderr: "engine stderr" },
        ),
      ),
    );
    const error = yield* service
      .command({ action: "status", target, jobId: "known-job" })
      .pipe(Effect.flip);
    expect(error.code).toBe("COMMAND_FAILED");
    expect(error.reason).toBe("Bad Request: invalid command parameters");
    expect(error.diagnostics).toMatchObject({
      phase: "status",
      exitCode: 6,
      stderr: "engine stderr",
      jobId: "known-job",
      outcome: "rejected",
    });
    expect(calls).toHaveLength(1);
  }),
);

it.effect("lost engine jobs remain unknown without resubmitting mutations", () =>
  Effect.gen(function* () {
    const calls: ProcessRunner.ProcessRunInput[] = [];
    const service = yield* UnityHooks.UnityHooks.pipe(
      Effect.provide(
        layer(
          JSON.stringify({
            success: false,
            errors: [
              {
                code: "COMMAND_FAILED",
                message: "Job Not Found. Jobs do not survive domain reloads",
              },
            ],
          }),
          calls,
          6,
        ),
      ),
    );
    const error = yield* service
      .command({ action: "status", target, jobId: "lost-job" })
      .pipe(Effect.flip);
    expect(error.code).toBe("job_unavailable");
    expect(error.diagnostics).toMatchObject({ jobId: "lost-job", outcome: "unknown" });
    expect(calls.map((c) => c.args.slice(0, 3))).toEqual([["job", "status", "lost-job"]]);
  }),
);

it.effect.each([
  { name: "timeout", timedOut: true, stdoutTruncated: false },
  { name: "truncation", timedOut: false, stdoutTruncated: true },
])("keeps incomplete $name results ambiguous and bounded", ({ timedOut, stdoutTruncated }) =>
  Effect.gen(function* () {
    const calls: ProcessRunner.ProcessRunInput[] = [];
    const service = yield* UnityHooks.UnityHooks.pipe(
      Effect.provide(
        layer('{"success":', calls, 0, undefined, {
          timedOut,
          stdoutTruncated,
          stderr: "x".repeat(5000),
        }),
      ),
    );
    const error = yield* service
      .command({ action: "submit", target, command: "respawn", parameters: {} })
      .pipe(Effect.flip);
    expect(error.code).toBe("cli_incomplete");
    expect(error.diagnostics).toMatchObject({
      timedOut,
      truncated: stdoutTruncated,
      outcome: "unknown",
    });
    expect(error.diagnostics?.stderr).toHaveLength(2048);
    expect(calls).toHaveLength(1);
  }),
);

it.effect("recovers observed terminal receipts across service restart, scoped by target", () =>
  Effect.gen(function* () {
    const files = new Map<string, string>();
    const calls: ProcessRunner.ProcessRunInput[] = [];
    const data = {
      jobId: "job1",
      state: "completed",
      command: "respawn",
      result: { success: false, reason: "Not playing" },
    };
    const first = yield* UnityHooks.UnityHooks.pipe(
      Effect.provide(layer(JSON.stringify({ success: true, data }), calls, 0, files)),
    );
    yield* first.command({ action: "status", target, jobId: "job1" });
    const restarted = yield* UnityHooks.UnityHooks.pipe(
      Effect.provide(layer("not json", calls, 6, files)),
    );
    expect(yield* restarted.command({ action: "status", target, jobId: "job1" })).toEqual({
      action: "job",
      ...data,
      recovered: true,
    });
    expect(calls).toHaveLength(1);
    expect(
      (yield* restarted
        .command({
          action: "status",
          target: { kind: "editor", projectPath: "/other-project" },
          jobId: "job1",
        })
        .pipe(Effect.flip)).code,
    ).toBe("cli_incomplete");
    expect(calls).toHaveLength(2);
  }),
);

it.effect("does not promote an accepted job into a completed receipt after reload", () =>
  Effect.gen(function* () {
    const files = new Map<string, string>();
    const calls: ProcessRunner.ProcessRunInput[] = [];
    const first = yield* UnityHooks.UnityHooks.pipe(
      Effect.provide(
        layer(
          JSON.stringify({ success: true, data: { jobId: "job1", state: "queued" } }),
          calls,
          0,
          files,
        ),
      ),
    );
    yield* first.command({ action: "submit", target, command: "respawn", parameters: {} });
    const restarted = yield* UnityHooks.UnityHooks.pipe(
      Effect.provide(layer("incomplete", calls, 6, files)),
    );
    expect(
      (yield* restarted.command({ action: "status", target, jobId: "job1" }).pipe(Effect.flip))
        .diagnostics?.outcome,
    ).toBe("unknown");
    expect(calls.map((c) => c.args[0])).toEqual(["command", "job"]);
  }),
);

it.effect("reports stopped Editors separately from legacy packages without opening a bridge", () =>
  Effect.gen(function* () {
    const calls: ProcessRunner.ProcessRunInput[] = [];
    const legacy = yield* UnityHooks.UnityHooks.pipe(
      Effect.provide(
        layer(
          JSON.stringify({ success: true, data: { commands: [{ name: "editor_status" }] } }),
          calls,
        ),
      ),
    );
    expect((yield* legacy.connect(target).pipe(Effect.flip)).code).toBe("integration_unavailable");
    const stopped = yield* UnityHooks.UnityHooks.pipe(
      Effect.provide(
        layer(
          JSON.stringify({
            success: false,
            errors: [{ code: "COMMAND_FAILED", message: "No Pipeline instance found for project" }],
          }),
          calls,
          6,
        ),
      ),
    );
    expect((yield* stopped.connect(target).pipe(Effect.flip)).code).toBe("target_unavailable");
    expect(calls.every((c) => c.args.includes("--query"))).toBe(true);
  }),
);

it.effect.each(["editor", "player"] as const)(
  "negotiates %s before opening a compatible bridge",
  (kind) =>
    Effect.gen(function* () {
      const calls: ProcessRunner.ProcessRunInput[] = [];
      const bridge = { protocol: 1, generation: "gen", port: 8080, token: "a".repeat(32) };
      const service = yield* UnityHooks.UnityHooks.pipe(
        Effect.provide(
          layer(
            (input) =>
              input.args.includes("--query")
                ? JSON.stringify({
                    success: true,
                    data: { commands: [{ name: "agent_game_capabilities" }] },
                  })
                : input.args[1] === "agent_game_capabilities"
                  ? envelope({ protocol: 1, target: kind, features: ["frames", "input", "hooks"] })
                  : envelope(bridge),
            calls,
          ),
        ),
      );
      const selected =
        kind === "editor"
          ? target
          : { kind: "player" as const, portFile: "/tmp/player/.unity-pipeline-runtime-port" };
      expect(yield* service.connect(selected)).toEqual(bridge);
      expect(calls.map((c) => c.args[1])).toEqual([
        "--detail",
        "agent_game_capabilities",
        "agent_game_connect",
      ]);
      expect(
        calls.every((c) =>
          c.args.includes(kind === "editor" ? "--project-path" : "--runtime-path"),
        ),
      ).toBe(true);
    }),
);

it.effect("rejects a wrong protocol before credentials or input are requested", () =>
  Effect.gen(function* () {
    const calls: ProcessRunner.ProcessRunInput[] = [];
    const service = yield* UnityHooks.UnityHooks.pipe(
      Effect.provide(
        layer(
          (input) =>
            input.args.includes("--query")
              ? JSON.stringify({
                  success: true,
                  data: { commands: [{ name: "agent_game_capabilities" }] },
                })
              : envelope({
                  protocol: 99,
                  target: "editor",
                  features: ["frames", "input", "hooks"],
                }),
          calls,
        ),
      ),
    );
    expect((yield* service.connect(target).pipe(Effect.flip)).code).toBe(
      "incompatible_integration",
    );
    expect(calls).toHaveLength(2);
  }),
);
