import assert from "node:assert/strict";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { beforeEach, vi } from "vitest";

import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { SmolAgentProvider } from "../Services/SmolAgentProvider.ts";
import { makeSmolAgentProviderLive } from "./SmolAgentProvider.ts";

const runtimeMock = vi.hoisted(() => {
  const state = {
    runHelpError: null as Error | null,
    lastCommand: null as {
      binaryPath: string;
      args: ReadonlyArray<string>;
      cwd?: string;
    } | null,
  };

  return {
    state,
    reset() {
      state.runHelpError = null;
      state.lastCommand = null;
    },
  };
});

vi.mock("../smolAgentRuntime.ts", async () => {
  const actual =
    await vi.importActual<typeof import("../smolAgentRuntime.ts")>("../smolAgentRuntime.ts");

  return {
    ...actual,
    runSmolAgentCommand: vi.fn((input) => {
      runtimeMock.state.lastCommand = input;
      if (runtimeMock.state.runHelpError) {
        return Effect.fail(runtimeMock.state.runHelpError);
      }
      return Effect.succeed({
        stdout: "smol-agent — a small coding agent powered by local and cloud LLMs\n",
        stderr: "",
        code: 0,
      });
    }),
  };
});

beforeEach(() => {
  runtimeMock.reset();
});

const makeTestLayer = (settingsOverrides?: Parameters<typeof ServerSettingsService.layerTest>[0]) =>
  makeSmolAgentProviderLive().pipe(
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), process.cwd())),
    Layer.provideMerge(ServerSettingsService.layerTest(settingsOverrides)),
    Layer.provideMerge(NodeServices.layer),
  );

it.layer(makeTestLayer())("SmolAgentProviderLive", (it) => {
  it.effect("shows a missing binary message when smol-agent is not installed", () =>
    Effect.gen(function* () {
      runtimeMock.state.runHelpError = new Error("spawn smol-agent ENOENT");
      const provider = yield* SmolAgentProvider;
      const snapshot = yield* provider.refresh;

      assert.equal(snapshot.status, "error");
      assert.equal(snapshot.installed, false);
      assert.equal(
        snapshot.message,
        "smol-agent CLI (`smol-agent`) is not installed or not on PATH.",
      );
    }).pipe(
      Effect.provide(
        makeTestLayer({
          providers: {
            smolAgent: {
              enabled: true,
            },
          },
        }),
      ),
    ),
  );

  it.effect("publishes the configured upstream default model as the built-in picker option", () =>
    Effect.gen(function* () {
      const provider = yield* SmolAgentProvider;
      const snapshot = yield* provider.refresh;

      assert.deepEqual(
        snapshot.models.map((model) => model.slug),
        ["gpt-4o"],
      );
      assert.equal(snapshot.models[0]?.isCustom, false);
    }).pipe(
      Effect.provide(
        makeTestLayer({
          providers: {
            smolAgent: {
              enabled: true,
              llmProvider: "openai",
            },
          },
        }),
      ),
    ),
  );
});
