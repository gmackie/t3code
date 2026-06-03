import {
  GrokBuildSettings,
  ProviderDriverKind,
  type ServerProviderModel,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { createModelCapabilities } from "@t3tools/shared/model";
import {
  buildServerProvider,
  collectStreamAsString,
  isCommandMissingCause,
  parseGenericCliVersion,
  providerModelsFromSettings,
  type ServerProviderDraft,
} from "../providerSnapshot.ts";
import { buildCursorDiscoveredModelsFromConfigOptions } from "./CursorProvider.ts";
import { makeGrokAcpRuntime } from "../acp/GrokAcpSupport.ts";
import type * as EffectAcpSchema from "effect-acp/schema";

const PROVIDER = ProviderDriverKind.make("grokBuild");
const GROK_BUILD_PRESENTATION = {
  displayName: "Grok Build",
  badgeLabel: "Early Access",
  showInteractionModeToggle: true,
} as const;
const EMPTY_CAPABILITIES = createModelCapabilities({
  optionDescriptors: [],
});
const GROK_BUILD_VERSION_TIMEOUT_MS = 8_000;
const GROK_BUILD_ACP_TIMEOUT_MS = 15_000;

function getGrokBuildFallbackModels(
  grokBuildSettings: GrokBuildSettings,
): ReadonlyArray<ServerProviderModel> {
  return providerModelsFromSettings(
    [],
    PROVIDER,
    grokBuildSettings.customModels,
    EMPTY_CAPABILITIES,
  );
}

function looksLikeAuthFailure(message: string | undefined): boolean {
  const lower = message?.toLowerCase() ?? "";
  return (
    lower.includes("auth") ||
    lower.includes("login") ||
    lower.includes("oauth") ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden")
  );
}

function buildGrokDiscoveredModelsFromSessionModels(
  models: EffectAcpSchema.SessionModelState | null | undefined,
): ReadonlyArray<ServerProviderModel> {
  if (!models || models.availableModels.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  return models.availableModels.flatMap((model) => {
    const slug = model.modelId.trim();
    if (!slug || seen.has(slug)) {
      return [];
    }
    seen.add(slug);
    return [
      {
        slug,
        name: model.name.trim() || slug,
        isCustom: false,
        capabilities: EMPTY_CAPABILITIES,
      } satisfies ServerProviderModel,
    ];
  });
}

function buildGrokDiscoveredModelsFromSessionSetup(
  setup:
    | EffectAcpSchema.LoadSessionResponse
    | EffectAcpSchema.NewSessionResponse
    | EffectAcpSchema.ResumeSessionResponse,
): ReadonlyArray<ServerProviderModel> {
  const modelsFromSessionState = buildGrokDiscoveredModelsFromSessionModels(setup.models);
  return modelsFromSessionState.length > 0
    ? modelsFromSessionState
    : buildCursorDiscoveredModelsFromConfigOptions(setup.configOptions);
}

const runGrokBuildCommand = (
  grokBuildSettings: GrokBuildSettings,
  args: ReadonlyArray<string>,
  environment: NodeJS.ProcessEnv = process.env,
) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(
      ChildProcess.make(grokBuildSettings.binaryPath, [...args], {
        env: environment,
        shell: process.platform === "win32",
      }),
    );

    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        collectStreamAsString(child.stdout),
        collectStreamAsString(child.stderr),
        child.exitCode.pipe(Effect.map(Number)),
      ],
      { concurrency: "unbounded" },
    );

    return { stdout, stderr, code: exitCode };
  }).pipe(Effect.scoped);

export function buildInitialGrokBuildProviderSnapshot(
  grokBuildSettings: GrokBuildSettings,
): Effect.Effect<ServerProviderDraft> {
  return Effect.gen(function* () {
    const checkedAt = yield* Effect.map(DateTime.now, DateTime.formatIso);
    const models = getGrokBuildFallbackModels(grokBuildSettings);

    if (!grokBuildSettings.enabled) {
      return buildServerProvider({
        presentation: GROK_BUILD_PRESENTATION,
        enabled: false,
        checkedAt,
        models,
        probe: {
          installed: false,
          version: null,
          status: "warning",
          auth: { status: "unknown" },
          message: "Grok Build is disabled in T3 Code settings.",
        },
      });
    }

    return buildServerProvider({
      presentation: GROK_BUILD_PRESENTATION,
      enabled: true,
      checkedAt,
      models,
      probe: {
        installed: true,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Checking Grok Build availability...",
      },
    });
  });
}

export const checkGrokBuildProviderStatus = Effect.fn("checkGrokBuildProviderStatus")(function* (
  grokBuildSettings: GrokBuildSettings,
  cwd: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  const fallbackModels = getGrokBuildFallbackModels(grokBuildSettings);

  if (!grokBuildSettings.enabled) {
    return buildServerProvider({
      presentation: GROK_BUILD_PRESENTATION,
      enabled: false,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: false,
        version: null,
        status: "warning",
        auth: { status: "unknown" },
        message: "Grok Build is disabled in T3 Code settings.",
      },
    });
  }

  const versionResult = yield* Effect.exit(
    runGrokBuildCommand(grokBuildSettings, ["version"], environment).pipe(
      Effect.timeout(GROK_BUILD_VERSION_TIMEOUT_MS),
    ),
  );

  if (versionResult._tag === "Failure") {
    const error = versionResult.cause;
    const errorMessage = Cause.pretty(error);
    return buildServerProvider({
      presentation: GROK_BUILD_PRESENTATION,
      enabled: true,
      checkedAt,
      models: fallbackModels,
      probe: {
        installed: !isCommandMissingCause({ message: errorMessage }),
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: isCommandMissingCause({ message: errorMessage })
          ? "Grok CLI (`grok`) is not installed or not on PATH."
          : `Failed to execute Grok CLI health check: ${errorMessage}.`,
      },
    });
  }

  const version = parseGenericCliVersion(
    `${versionResult.value.stdout}\n${versionResult.value.stderr}`,
  );

  const acpDiscovery = yield* Effect.exit(
    Effect.gen(function* () {
      const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const runtime = yield* makeGrokAcpRuntime({
        grokBuildSettings,
        environment,
        childProcessSpawner,
        cwd,
        clientInfo: { name: "t3-code-provider-probe", version: "0.0.0" },
      });
      const started = yield* runtime.start();
      return buildGrokDiscoveredModelsFromSessionSetup(started.sessionSetupResult);
    }).pipe(Effect.timeoutOption(GROK_BUILD_ACP_TIMEOUT_MS), Effect.scoped),
  );

  if (acpDiscovery._tag === "Success" && acpDiscovery.value._tag === "Some") {
    const discoveredModels = acpDiscovery.value.value;
    return buildServerProvider({
      presentation: GROK_BUILD_PRESENTATION,
      enabled: true,
      checkedAt,
      models: providerModelsFromSettings(
        discoveredModels,
        PROVIDER,
        grokBuildSettings.customModels,
        EMPTY_CAPABILITIES,
      ),
      probe: {
        installed: true,
        version,
        status: discoveredModels.length > 0 ? "ready" : "warning",
        auth: { status: "authenticated" },
        ...(discoveredModels.length === 0
          ? { message: "Grok Build ACP model discovery returned no built-in models." }
          : {}),
      },
    });
  }

  const authFailure =
    acpDiscovery._tag === "Failure" ? looksLikeAuthFailure(acpDiscovery.cause.toString()) : false;
  return buildServerProvider({
    presentation: GROK_BUILD_PRESENTATION,
    enabled: true,
    checkedAt,
    models: fallbackModels,
    probe: {
      installed: true,
      version,
      status: authFailure ? "warning" : "ready",
      auth: authFailure ? { status: "unauthenticated" } : { status: "unknown" },
      ...(authFailure
        ? { message: "Grok Build requires authentication. Run `grok login` and try again." }
        : { message: "Grok Build is installed, but ACP model discovery could not be completed." }),
    },
  });
});
