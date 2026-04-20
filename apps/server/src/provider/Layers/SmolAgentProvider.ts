import type { SmolAgentSettings, ServerProvider } from "@t3tools/contracts";
import { Effect, Equal, Layer, Stream } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";

import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { makeManagedServerProvider } from "../makeManagedServerProvider.ts";
import {
  buildServerProvider,
  isCommandMissingCause,
  providerModelsFromSettings,
} from "../providerSnapshot.ts";
import { SmolAgentProvider } from "../Services/SmolAgentProvider.ts";
import {
  DEFAULT_SMOL_AGENT_MODEL_CAPABILITIES,
  getSmolAgentDefaultModel,
  runSmolAgentCommand,
} from "../smolAgentRuntime.ts";

const PROVIDER = "smolAgent" as const;

function getSmolAgentBuiltInModels(settings: SmolAgentSettings) {
  const defaultModel = getSmolAgentDefaultModel(settings.llmProvider);
  return [
    {
      slug: defaultModel,
      name: defaultModel,
      isCustom: false,
      capabilities: DEFAULT_SMOL_AGENT_MODEL_CAPABILITIES,
    },
  ] as const;
}

function buildInitialSmolAgentProviderSnapshot(settings: SmolAgentSettings): ServerProvider {
  const checkedAt = new Date().toISOString();
  const models = providerModelsFromSettings(
    getSmolAgentBuiltInModels(settings),
    PROVIDER,
    settings.customModels,
    DEFAULT_SMOL_AGENT_MODEL_CAPABILITIES,
  );

  if (!settings.enabled) {
    return buildServerProvider({
      provider: PROVIDER,
      enabled: false,
      checkedAt,
      models,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "smol-agent is disabled in T3 Code settings.",
      },
    });
  }

  return buildServerProvider({
    provider: PROVIDER,
    enabled: true,
    checkedAt,
    models,
    probe: {
      installed: true,
      version: null,
      status: "warning",
      auth: { status: "unknown" },
      message: "Checking smol-agent availability...",
    },
  });
}

export function checkSmolAgentProviderStatus(input: {
  readonly settings: SmolAgentSettings;
  readonly cwd: string;
}): Effect.Effect<ServerProvider, never, ChildProcessSpawner.ChildProcessSpawner> {
  const checkedAt = new Date().toISOString();
  const models = providerModelsFromSettings(
    getSmolAgentBuiltInModels(input.settings),
    PROVIDER,
    input.settings.customModels,
    DEFAULT_SMOL_AGENT_MODEL_CAPABILITIES,
  );

  return Effect.gen(function* () {
    if (!input.settings.enabled) {
      return buildServerProvider({
        provider: PROVIDER,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "smol-agent is disabled in T3 Code settings.",
        },
      });
    }

    const result = yield* runSmolAgentCommand({
      binaryPath: input.settings.binaryPath,
      args: ["--help"],
      cwd: input.cwd,
    }).pipe(Effect.result);

    if (result._tag === "Failure") {
      const error = result.failure;
      return buildServerProvider({
        provider: PROVIDER,
        enabled: true,
        checkedAt,
        models,
        probe: {
          installed: !isCommandMissingCause(error),
          version: null,
          status: "error",
          auth: { status: "unknown" },
          message: isCommandMissingCause(error)
            ? "smol-agent CLI (`smol-agent`) is not installed or not on PATH."
            : `Failed to execute smol-agent CLI health check: ${error.message}`,
        },
      });
    }

    return buildServerProvider({
      provider: PROVIDER,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "ready",
        auth: { status: "unknown" },
      },
    });
  }).pipe(Effect.orDie);
}

export const makeSmolAgentProviderLive = () =>
  Layer.effect(
    SmolAgentProvider,
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig;
      const serverSettings = yield* ServerSettingsService;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const checkProvider = serverSettings.getSettings.pipe(
        Effect.map((settings) => settings.providers.smolAgent),
        Effect.orDie,
        Effect.flatMap((settings) =>
          checkSmolAgentProviderStatus({
            settings,
            cwd: serverConfig.cwd,
          }),
        ),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
      );

      return yield* makeManagedServerProvider<SmolAgentSettings>({
        getSettings: serverSettings.getSettings.pipe(
          Effect.map((settings) => settings.providers.smolAgent),
          Effect.orDie,
        ),
        streamSettings: serverSettings.streamChanges.pipe(
          Stream.map((settings) => settings.providers.smolAgent),
        ),
        haveSettingsChanged: (previous, next) => !Equal.equals(previous, next),
        initialSnapshot: buildInitialSmolAgentProviderSnapshot,
        checkProvider,
        refreshInterval: "1 hour",
      });
    }),
  );

export const SmolAgentProviderLive = makeSmolAgentProviderLive();
