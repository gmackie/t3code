import * as path from "node:path";
import * as os from "node:os";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Stream } from "effect";

import { ThreadId } from "@t3tools/contracts";

import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { SmolAgentAdapter } from "../Services/SmolAgentAdapter.ts";
import { makeSmolAgentAdapterLive } from "./SmolAgentAdapter.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mockAgentPath = path.join(__dirname, "../../../scripts/acp-mock-agent.ts");
const bunExe = "bun";

async function makeMockAgentWrapper(extraEnv?: Record<string, string>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "smol-agent-acp-mock-"));
  const wrapperPath = path.join(dir, "fake-smol-agent.sh");
  const envExports = Object.entries(extraEnv ?? {})
    .map(([key, value]) => `export ${key}=${JSON.stringify(value)}`)
    .join("\n");
  const script = `#!/bin/sh
${envExports}
exec ${JSON.stringify(bunExe)} ${JSON.stringify(mockAgentPath)} "$@"
`;
  await writeFile(wrapperPath, script, "utf8");
  await chmod(wrapperPath, 0o755);
  return wrapperPath;
}

async function waitForFileContent(filePath: string, attempts = 40) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const raw = await readFile(filePath, "utf8");
      if (raw.trim().length > 0) {
        return raw;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for file content at ${filePath}`);
}

const smolAgentAdapterTestLayer = it.layer(
  makeSmolAgentAdapterLive().pipe(
    Layer.provideMerge(ServerSettingsService.layerTest()),
    Layer.provideMerge(
      ServerConfig.layerTest(process.cwd(), {
        prefix: "t3code-smol-agent-adapter-test-",
      }),
    ),
    Layer.provideMerge(NodeServices.layer),
  ),
);

smolAgentAdapterTestLayer("SmolAgentAdapterLive", (it) => {
  it.effect("starts a session and maps mock ACP prompt flow to runtime events", () =>
    Effect.gen(function* () {
      const adapter = yield* SmolAgentAdapter;
      const settings = yield* ServerSettingsService;
      const threadId = ThreadId.make("smol-agent-mock-thread");

      const wrapperPath = yield* Effect.promise(() => makeMockAgentWrapper());
      yield* settings.updateSettings({
        providers: {
          smolAgent: {
            binaryPath: wrapperPath,
          },
        },
      });

      const runtimeEventsFiber = yield* Stream.take(adapter.streamEvents, 8).pipe(
        Stream.runCollect,
        Effect.forkChild,
      );

      const session = yield* adapter.startSession({
        threadId,
        provider: "smolAgent",
        cwd: process.cwd(),
        runtimeMode: "full-access",
        modelSelection: { provider: "smolAgent", model: "qwen2.5-coder:32b" },
      });

      assert.equal(session.provider, "smolAgent");
      assert.equal(session.model, "qwen2.5-coder:32b");

      yield* adapter.sendTurn({
        threadId,
        input: "hello mock",
        attachments: [],
      });

      const runtimeEvents = Array.from(yield* Fiber.join(runtimeEventsFiber));
      const types = runtimeEvents.map((event) => event.type);

      for (const type of [
        "session.started",
        "session.state.changed",
        "thread.started",
        "turn.started",
        "item.started",
        "content.delta",
        "item.completed",
        "turn.completed",
      ] as const) {
        assert.include(types, type);
      }
    }),
  );

  it.effect("advertises unsupported in-session model switching", () =>
    Effect.gen(function* () {
      const adapter = yield* SmolAgentAdapter;
      assert.deepEqual(adapter.capabilities, { sessionModelSwitch: "unsupported" });
    }),
  );

  it.effect("closes the ACP child process when a session stops", () =>
    Effect.gen(function* () {
      const adapter = yield* SmolAgentAdapter;
      const settings = yield* ServerSettingsService;
      const threadId = ThreadId.make("smol-agent-stop-session-close");
      const tempDir = yield* Effect.promise(() =>
        mkdtemp(path.join(os.tmpdir(), "smol-agent-adapter-exit-log-")),
      );
      const exitLogPath = path.join(tempDir, "exit.log");

      const wrapperPath = yield* Effect.promise(() =>
        makeMockAgentWrapper({
          T3_ACP_EXIT_LOG_PATH: exitLogPath,
        }),
      );
      yield* settings.updateSettings({
        providers: {
          smolAgent: {
            binaryPath: wrapperPath,
          },
        },
      });

      yield* adapter.startSession({
        threadId,
        provider: "smolAgent",
        cwd: process.cwd(),
        runtimeMode: "full-access",
        modelSelection: { provider: "smolAgent", model: "qwen2.5-coder:32b" },
      });

      yield* adapter.stopSession(threadId);

      const exitLog = yield* Effect.promise(() => waitForFileContent(exitLogPath));
      assert.include(exitLog, "SIGTERM");
    }),
  );
});
