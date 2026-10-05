// @effect-diagnostics abortControllerInEffect:off - Node request cancellation is the transport boundary and is forwarded to Effect runner cancellation.
// @effect-diagnostics nodeBuiltinImport:off - Node HTTP implements the private loopback server transport, not outbound API calls.
// @effect-diagnostics preferSchemaOverJson:off - JSON string literals safely embed paths in generated JavaScript.
import * as NodeHttp from "node:http";
import * as NodeCrypto from "node:crypto";
import { DeviceOperationError, type DeviceError, type DeviceSession } from "@t3tools/contracts";
import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { resolveNodeExecutable } from "@t3tools/shared/nodeRuntime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as ProcessRunner from "../processRunner.ts";

const Request = Schema.fromJsonString(
  Schema.Struct({
    capability: Schema.String.check(Schema.isMaxLength(128)),
    args: Schema.Array(Schema.String.check(Schema.isMaxLength(8192))).check(
      Schema.isMaxLength(256),
    ),
  }),
);
const deviceCommands = new Set([
  "snapshot",
  "click",
  "press",
  "fill",
  "longpress",
  "hover",
  "swipe",
  "focus",
  "type",
  "scroll",
  "get",
  "is",
  "find",
  "gesture",
  "open",
  "close",
  "install",
  "reinstall",
  "push",
  "trigger-app-event",
  "home",
  "back",
  "screenshot",
  "wait",
  "alert",
  "settings",
  "clipboard",
  "keyboard",
  "orientation",
  "fold",
  "viewport",
  "appstate",
  "app-switcher",
  "action-button",
  "help",
  "version",
  "--help",
  "--version",
]);
const decodeRequest = Schema.decodeUnknownEffect(Request);
const failed = () =>
  new DeviceOperationError({
    operation: "Preflight device command",
    reason: "request_failed",
    cause: new Error("The scoped device command could not execute."),
  });
interface Registration {
  readonly session: DeviceSession;
  readonly targetArgs: ReadonlyArray<string>;
  readonly entryPath: string;
  readonly publicArgs: ReadonlyArray<string>;
}

/** Execute managed CLI commands in the server, where close and lease checks can fence them. */
export const make = Effect.fn("PreflightDeviceLauncher.make")(function* (
  stateDir: string,
  command: <A>(
    session: DeviceSession,
    effect: Effect.Effect<A, DeviceError>,
  ) => Effect.Effect<A, DeviceError>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runner = yield* ProcessRunner.ProcessRunner;
  const platform = yield* HostProcessPlatform;
  const environment = yield* HostProcessEnvironment;
  const node = yield* resolveNodeExecutable("Device automation").pipe(Effect.mapError(failed));
  const scope = yield* Scope.Scope;
  const services = yield* Effect.context<never>();
  const registrations = new Map<string, Registration>();
  const execute = Effect.fn("PreflightDeviceLauncher.execute")(function* (
    request: NodeHttp.IncomingMessage,
    response: NodeHttp.ServerResponse,
  ) {
    if (
      request.method !== "POST" ||
      request.url !== "/command" ||
      request.headers.origin !== undefined
    ) {
      response.writeHead(403).end();
      return;
    }
    const body = yield* Effect.tryPromise({
      try: async () => {
        let bytes = 0;
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bytes += buffer.byteLength;
          if (bytes > 128_000) throw new Error("request limit");
          chunks.push(buffer);
        }
        return Buffer.concat(chunks).toString("utf8");
      },
      catch: failed,
    }).pipe(Effect.timeout("5 seconds"), Effect.mapError(failed));
    const input = yield* decodeRequest(body).pipe(Effect.mapError(failed));
    const registration = registrations.get(input.capability);
    if (!registration || !deviceCommands.has(input.args[0] ?? "")) return yield* failed();
    // All targeting flags must exactly match the service-issued invocation. Reject duplicates and aliases.
    const flags = ["--config", "--session", "--platform", "--udid", "--serial"];
    for (const flag of flags) {
      const expected = registration.publicArgs.indexOf(flag);
      const actual = input.args.indexOf(flag);
      if (
        input.args.some((arg) => arg.startsWith(`${flag}=`)) ||
        input.args.lastIndexOf(flag) !== actual ||
        (expected >= 0
          ? actual < 0 || input.args[actual + 1] !== registration.publicArgs[expected + 1]
          : actual >= 0)
      )
        return yield* failed();
    }
    const forbidden = [
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
      "--session-isolation",
      "--tenant",
      "--run-id",
      "--lease-id",
      "--lease-backend",
      "--",
      "--aws-device-arn",
      "--ios-simulator-device-set",
      "--device-hub",
      "--android-device-allowlist",
      "--os-version",
      "--device-orientation",
      "--geo-location",
      "--timezone",
      "--appium-version",
      "--language",
      "--locale",
      "--network-profile",
      "--custom-network",
    ];
    if (
      input.args.some(
        (arg) =>
          arg.startsWith("--daemon-") ||
          arg.startsWith("--provider-") ||
          forbidden.some((flag) => arg === flag || arg.startsWith(`${flag}=`)),
      )
    )
      return yield* failed();
    const serverArgs = input.args.filter(
      (_, index) =>
        index !== input.args.indexOf("--session") && index !== input.args.indexOf("--session") + 1,
    );
    for (const flag of ["--config", "--session"]) {
      const index = registration.targetArgs.indexOf(flag);
      if (index < 0 || !registration.targetArgs[index + 1]) return yield* failed();
      serverArgs.push(flag, registration.targetArgs[index + 1]!);
    }
    // Ambient daemon overrides never cross this boundary.
    const env = { ...environment };
    for (const name of Object.keys(env)) if (name.startsWith("AGENT_DEVICE_")) delete env[name];
    delete env.T3_PREFLIGHT_TOKEN;
    const output = yield* command(
      registration.session,
      runner
        .run({
          command: node,
          args: [registration.entryPath, ...serverArgs],
          env,
          extendEnv: false,
          timeout: "90 seconds",
          maxOutputBytes: 1_000_000,
        })
        .pipe(Effect.mapError(failed)),
    );
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({ stdout: output.stdout, stderr: output.stderr, code: output.code ?? 1 }),
    );
  });
  const server = NodeHttp.createServer((request, response) => {
    const controller = new AbortController();
    request.once("aborted", () => controller.abort());
    response.once("close", () => {
      if (!response.writableFinished) controller.abort();
    });
    // Node's callback is the transport boundary; every operation remains in the service scope.
    void Effect.runPromiseWith(services)(
      Effect.scoped(
        Effect.gen(function* () {
          const child = yield* execute(request, response).pipe(Effect.forkIn(scope));
          yield* Effect.addFinalizer(() => Fiber.interrupt(child));
          return yield* Fiber.join(child);
        }),
      ),
      { signal: controller.signal },
    ).catch(() => {
      if (!response.headersSent) response.writeHead(409);
      response.end("Device lease or command unavailable. Reopen the bound session.");
    });
  });
  server.requestTimeout = 100_000;
  server.headersTimeout = 5_000;
  yield* Effect.callback<void, DeviceOperationError>((resume) => {
    server.once("error", () => resume(Effect.fail(failed())));
    server.listen(0, "127.0.0.1", () => resume(Effect.void));
  });
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      server.closeAllConnections();
      server.close();
      registrations.clear();
    }),
  );
  const address = server.address();
  if (!address || typeof address === "string") return yield* failed();
  const url = `http://127.0.0.1:${address.port}/command`;
  const prepare = Effect.fn("PreflightDeviceLauncher.prepare")(function* (
    input: Omit<Registration, "publicArgs">,
  ) {
    const capability = NodeCrypto.randomBytes(32).toString("base64url");
    for (const [previous, registration] of registrations) {
      if (
        registration.session.threadId === input.session.threadId &&
        registration.session.hostId === input.session.hostId &&
        registration.session.deviceId === input.session.deviceId
      )
        registrations.delete(previous);
    }
    const publicArgs = input.targetArgs.filter(
      (_, index) =>
        ![
          input.targetArgs.indexOf("--config"),
          input.targetArgs.indexOf("--config") + 1,
          input.targetArgs.indexOf("--session"),
          input.targetArgs.indexOf("--session") + 1,
        ].includes(index),
    );
    publicArgs.push("--session", NodeCrypto.randomBytes(16).toString("hex"));
    registrations.set(capability, { ...input, publicArgs });
    const id = NodeCrypto.createHash("sha256").update(capability).digest("hex");
    const directory = path.join(stateDir, "device", "preflight", id);
    yield* fs.makeDirectory(directory, { recursive: true });
    yield* fs.chmod(directory, 0o700);
    const script = path.join(directory, "launcher.mjs");
    const text = `const args = process.argv.slice(2);
const response = await fetch(${JSON.stringify(url)}, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ capability: ${JSON.stringify(capability)}, args }), signal: AbortSignal.timeout(100000) }).catch(() => null);
if (!response?.ok) { console.error("Device lease unavailable. Call device_open with its Preflight binding again."); process.exit(1); }
const result = await response.json();
process.stdout.write(result.stdout); process.stderr.write(result.stderr); process.exitCode = result.code;
`;
    yield* fs.writeFileString(script, text);
    yield* fs.chmod(script, 0o600);
    const launcher = path.join(
      directory,
      platform === "win32" ? "agent-device.cmd" : "agent-device",
    );
    const shell = [node, script]
      .map((value) => "'" + value.replaceAll("'", "'\"'\"'") + "'")
      .join(" ");
    yield* fs.writeFileString(
      launcher,
      platform === "win32"
        ? `@echo off\r\n"${node}" "${script}" %*\r\n`
        : `#!/bin/sh\nexec ${shell} "$@"\n`,
    );
    if (platform !== "win32") yield* fs.chmod(launcher, 0o700);
    return { command: launcher, targetArgs: publicArgs };
  }, Effect.mapError(failed));
  return prepare;
});
