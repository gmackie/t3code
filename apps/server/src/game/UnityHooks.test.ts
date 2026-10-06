import { it } from "@effect/vitest";
import { expect } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { ExitCode } from "effect/process/ChildProcessSpawner";
import type { UnityHookRequest } from "@t3tools/contracts";
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
function layer(stdout: string, calls: ProcessRunner.ProcessRunInput[], code = 0) {
  return UnityHooks.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(ProcessRunner.ProcessRunner, {
          run: (input) => {
            calls.push(input);
            return Effect.succeed({
              stdout,
              stderr: "",
              code: ExitCode(code),
              timedOut: false,
              stdoutTruncated: false,
              stderrTruncated: false,
              stdoutInvalidUtf8: false,
              stderrInvalidUtf8: false,
            });
          },
        }),
        FileSystem.layerNoop({
          realPath: (path) => Effect.succeed(path),
          exists: () => Effect.succeed(true),
        }),
        Path.layer,
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
