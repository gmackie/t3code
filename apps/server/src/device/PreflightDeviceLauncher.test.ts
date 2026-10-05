import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import {
  DeviceId,
  DeviceOperationError,
  LOCAL_DEVICE_HOST_ID,
  ThreadId,
  type DeviceSession,
} from "@t3tools/contracts";
import {
  HostProcessEnvironment,
  HostProcessIsExecutable,
  HostProcessPlatform,
} from "@t3tools/shared/hostProcess";
// @effect-diagnostics-next-line nodeBuiltinImport:off - Native HTTP socket destruction proves disconnect cancellation at the real transport boundary.
import * as NodeHttp from "node:http";
import * as Deferred from "effect/Deferred";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as ProcessRunner from "../processRunner.ts";
import * as PreflightDeviceLauncher from "./PreflightDeviceLauncher.ts";

const encodeCommand = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.Struct({
      capability: Schema.String,
      args: Schema.Array(Schema.String),
    }),
  ),
);

const session: DeviceSession = {
  threadId: ThreadId.make("launcher-thread"),
  hostId: LOCAL_DEVICE_HOST_ID,
  deviceId: DeviceId.make("launcher-device"),
  platform: "ios",
  openedAt: "2026-10-05T00:00:00Z",
  preflight: { sessionId: "preflight-lease", expiresAt: "2099-01-01T00:00:00Z" },
};
const target = [
  "--config",
  "/test/config.json",
  "--session",
  "thread-host-device",
  "--platform",
  "ios",
  "--udid",
  session.deviceId,
];

const fixture = Effect.fn("PreflightDeviceLauncher.test.fixture")(function* (options?: {
  readonly realNative?: boolean;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const realRunner = yield* ProcessRunner.ProcessRunner;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-preflight-launcher-" });
  const calls: ProcessRunner.ProcessRunInput[] = [];
  const commandSessions: DeviceSession[] = [];
  const controls = { live: true, block: false };
  const started = yield* Deferred.make<void>();
  const cancelled = yield* Deferred.make<void>();
  const entryPath = options?.realNative
    ? path.join(directory, "native.mjs")
    : "/test/agent-device.mjs";
  if (options?.realNative) {
    yield* fs.writeFileString(
      entryPath,
      `const forbidden = ["T3_PREFLIGHT_TOKEN", "AGENT_DEVICE_DAEMON_BASE_URL", "AGENT_DEVICE_DAEMON_AUTH_TOKEN", "AGENT_DEVICE_CONFIG", "AGENT_DEVICE_TENANT", "PATH"];
process.stdout.write(forbidden.every(key => process.env[key] === undefined) && process.env.PREFLIGHT_TEST_ALLOWED === "retained" ? "isolated\\n" : "leaked\\n");`,
    );
  }
  const fakeRunner: ProcessRunner.ProcessRunner["Service"] = {
    run: (input) =>
      Effect.gen(function* () {
        calls.push(input);
        if (controls.block)
          return yield* Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Deferred.succeed(cancelled, undefined)),
          );
        if (options?.realNative) return yield* realRunner.run(input);
        return {
          code: ChildProcessSpawner.ExitCode(0),
          stdout: "executed\n",
          stderr: "",
          timedOut: false,
          stdoutTruncated: false,
          stderrTruncated: false,
          stdoutInvalidUtf8: false,
          stderrInvalidUtf8: false,
        };
      }),
  };
  const command: Parameters<typeof PreflightDeviceLauncher.make>[1] = (bound, execute) =>
    Effect.suspend(() => {
      commandSessions.push(bound);
      return controls.live
        ? execute
        : Effect.fail(
            new DeviceOperationError({
              operation: "lease",
              reason: "request_failed",
              cause: new Error("Lease expired or released"),
            }),
          );
    });
  const prepare = yield* PreflightDeviceLauncher.make(directory, command).pipe(
    Effect.provideService(ProcessRunner.ProcessRunner, fakeRunner),
    Effect.provideService(HostProcessIsExecutable, false),
    Effect.provideService(HostProcessPlatform, "linux"),
    Effect.provideService(HostProcessEnvironment, {
      T3_PREFLIGHT_TOKEN: "fake-producer-secret",
      AGENT_DEVICE_DAEMON_BASE_URL: "https://wrong.test",
      AGENT_DEVICE_DAEMON_AUTH_TOKEN: "fake-daemon-secret",
      AGENT_DEVICE_CONFIG: "/wrong/config.json",
      AGENT_DEVICE_TENANT: "wrong-tenant",
      PREFLIGHT_TEST_ALLOWED: "retained",
    }),
  );
  const launcher = yield* prepare({
    session,
    entryPath,
    targetArgs: target,
  });
  const scriptPath = path.join(path.dirname(launcher.command), "launcher.mjs");
  const script = yield* fs.readFileString(scriptPath);
  const capability = /capability: "([A-Za-z0-9_-]+)"/.exec(script)?.[1];
  expect(capability).toBeDefined();
  const run = (args: ReadonlyArray<string>) =>
    realRunner.run({ command: process.execPath, args: [scriptPath, ...args] });
  return {
    calls,
    commandSessions,
    controls,
    launcher: launcher.command,
    target: launcher.targetArgs,
    scriptPath,
    script,
    capability,
    run,
    fs,
    started,
    cancelled,
    reopen: () =>
      prepare({
        session: {
          ...session,
          preflight: { sessionId: "new-lease", expiresAt: "2099-01-01T00:00:00Z" },
        },
        entryPath,
        targetArgs: target,
      }),
    runLauncher: (command: string, args: ReadonlyArray<string>) =>
      realRunner.run({ command, args }),
  };
});

const dependencies = ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer));

describe("PreflightDeviceLauncher", () => {
  it.effect(
    "the generated launcher uses the real local HTTP boundary and the scoped command collaborator",
    () =>
      Effect.gen(function* () {
        const test = yield* fixture();
        const result = yield* test.run(["snapshot", ...test.target]);
        expect(result.code).toBe(0);
        expect(result.stdout).toBe("executed\n");
        expect(test.commandSessions).toEqual([session]);
        expect(test.calls).toHaveLength(1);
        expect(test.calls[0]?.args).toEqual([
          "/test/agent-device.mjs",
          "snapshot",
          "--platform",
          "ios",
          "--udid",
          session.deviceId,
          "--config",
          "/test/config.json",
          "--session",
          "thread-host-device",
        ]);
        expect(test.target).not.toContain("/test/config.json");
        expect(test.target).not.toContain("thread-host-device");
        expect(test.calls[0]?.extendEnv).toBe(false);
        expect(test.calls[0]?.env?.T3_PREFLIGHT_TOKEN).toBeUndefined();
        expect(test.calls[0]?.env?.AGENT_DEVICE_DAEMON_BASE_URL).toBeUndefined();
        expect(test.calls[0]?.env?.AGENT_DEVICE_DAEMON_AUTH_TOKEN).toBeUndefined();
        expect(test.calls[0]?.env?.AGENT_DEVICE_CONFIG).toBeUndefined();
        expect(result.stdout).not.toContain(test.capability);
        expect(result.stderr).not.toContain(test.capability);
        expect(test.launcher).not.toContain(test.capability);
        expect(test.script).not.toContain("lease-test");
        const info = yield* test.fs.stat(test.scriptPath);
        expect(info.mode & 0o777).toBe(0o600);
      }).pipe(Effect.scoped, Effect.provide(dependencies)),
  );

  it.effect.each([
    [
      "retargeted device",
      (args: ReadonlyArray<string>) =>
        args.map((value) => (value === session.deviceId ? "other-device" : value)),
    ],
    [
      "duplicate target flag",
      (args: ReadonlyArray<string>) => [...args, "--udid", session.deviceId],
    ],
    ["target alias", (args: ReadonlyArray<string>) => [...args, "--serial=other-device"]],
    ["missing session", (args: ReadonlyArray<string>) => args.slice(0, -2)],
    ["option terminator", (args: ReadonlyArray<string>) => ["--", ...args]],
    [
      "private session",
      (args: ReadonlyArray<string>) => [...args.slice(0, -1), "thread-host-device"],
    ],
    ...[
      "--daemon-base-url",
      "--daemon-auth-token",
      "--remote-config",
      "--daemon-transport",
      "--state-dir",
      "--device",
      "--target",
      "--session-lock",
      "--provider",
      "--host",
      "--config",
      "--tenant",
      "--run-id",
      "--lease-id",
      "--lease-backend",
      "--daemon-server-mode",
      "--provider-session",
      "--ios-simulator-device-set",
      "--device-hub",
    ].map((flag) => [flag, (args: ReadonlyArray<string>) => [...args, `${flag}=other`]] as const),
  ] as const)("rejects %s before executing a native command", ([_name, change]) =>
    Effect.gen(function* () {
      const test = yield* fixture();
      const result = yield* test.run(["snapshot", ...change(test.target)]);
      expect(result.code).toBe(1);
      expect(test.calls).toEqual([]);
      expect(test.commandSessions).toEqual([]);
      expect(result.stderr).toContain("Device lease unavailable");
      expect(result.stderr).not.toContain(test.capability);
    }).pipe(Effect.scoped, Effect.provide(dependencies)),
  );

  it.effect.each(["batch", "replay", "connect"])(
    "rejects the %s command before native execution",
    (command) =>
      Effect.gen(function* () {
        const test = yield* fixture();
        const result = yield* test.run([command, ...test.target]);
        expect(result.code).toBe(1);
        expect(test.calls).toEqual([]);
        expect(test.commandSessions).toEqual([]);
        expect(result.stderr).toContain("Device lease unavailable");
      }).pipe(Effect.scoped, Effect.provide(dependencies)),
  );

  it.effect(
    "native subprocess receives the sanitized environment without inheriting ambient values",
    () =>
      Effect.gen(function* () {
        const environment = yield* HostProcessEnvironment;
        expect(environment.PATH).toBeTruthy();
        const test = yield* fixture({ realNative: true });
        const result = yield* test.run(["snapshot", ...test.target]);
        expect(result.code).toBe(0);
        expect(result.stdout).toBe("isolated\n");
      }).pipe(Effect.scoped, Effect.provide(dependencies)),
  );

  it.effect("disconnecting the command transport interrupts an active native command", () =>
    Effect.gen(function* () {
      const test = yield* fixture();
      test.controls.block = true;
      const url = /fetch\("([^"]+)"/.exec(test.script)?.[1];
      expect(url).toBeDefined();
      if (!url || !test.capability) return yield* Effect.die("Missing private launcher transport");
      const body = encodeCommand({
        capability: test.capability,
        args: ["snapshot", ...test.target],
      });
      const request = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const request = NodeHttp.request(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
          });
          request.on("error", () => {});
          request.end(body);
          return request;
        }),
        (request) => Effect.sync(() => request.destroy()),
      );
      yield* Deferred.await(test.started);
      request.destroy();
      yield* Deferred.await(test.cancelled);
      expect(test.calls).toHaveLength(1);
    }).pipe(Effect.scoped, Effect.provide(dependencies)),
  );

  it.effect("reopening a device leaves an old executable unable to execute the new session", () =>
    Effect.gen(function* () {
      const test = yield* fixture();
      const next = yield* test.reopen();
      expect(next.command).not.toBe(test.launcher);
      expect(yield* test.fs.readFileString(test.scriptPath)).toBe(test.script);
      const stale = yield* test.runLauncher(test.launcher, ["snapshot", ...test.target]);
      expect(stale.code).toBe(1);
      expect(test.calls).toEqual([]);
      const current = yield* test.runLauncher(next.command, ["snapshot", ...next.targetArgs]);
      expect(current.code).toBe(0);
      expect(test.commandSessions[0]?.preflight?.sessionId).toBe("new-lease");
      expect(test.calls).toHaveLength(1);
    }).pipe(Effect.scoped, Effect.provide(dependencies)),
  );

  it.effect("released or expired command capabilities cannot execute the native runner", () =>
    Effect.gen(function* () {
      const test = yield* fixture();
      test.controls.live = false;
      const result = yield* test.run(["snapshot", ...test.target]);
      expect(result.code).toBe(1);
      expect(test.commandSessions).toEqual([session]);
      expect(test.calls).toEqual([]);
      expect(result.stderr).not.toContain(test.capability);
    }).pipe(Effect.scoped, Effect.provide(dependencies)),
  );
});
