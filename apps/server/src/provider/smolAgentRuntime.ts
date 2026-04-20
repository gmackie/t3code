import type { ModelCapabilities, SmolAgentSettings } from "@t3tools/contracts";
import { Effect } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { collectStreamAsString, type CommandResult } from "./providerSnapshot.ts";

export const DEFAULT_SMOL_AGENT_MODEL_CAPABILITIES: ModelCapabilities = {
  reasoningEffortLevels: [],
  supportsFastMode: false,
  supportsThinkingToggle: false,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
};

const DEFAULT_MODEL_BY_LLM_PROVIDER = {
  ollama: "qwen2.5-coder:32b",
  "ollama-api": "qwen2.5-coder:32b",
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-20250514",
  grok: "grok-4-latest",
  groq: "openai/gpt-oss-120b",
  gemini: "gemini-2.5-pro",
  codex: "gpt-5.4",
} as const satisfies Record<string, string>;

export function getSmolAgentDefaultModel(
  llmProvider: SmolAgentSettings["llmProvider"] | null | undefined,
): string {
  const normalized = llmProvider?.trim().toLowerCase();
  if (!normalized) {
    return DEFAULT_MODEL_BY_LLM_PROVIDER.ollama;
  }
  if (normalized in DEFAULT_MODEL_BY_LLM_PROVIDER) {
    return DEFAULT_MODEL_BY_LLM_PROVIDER[normalized as keyof typeof DEFAULT_MODEL_BY_LLM_PROVIDER];
  }
  if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
    return "default";
  }
  return DEFAULT_MODEL_BY_LLM_PROVIDER.ollama;
}

export function runSmolAgentCommand(input: {
  readonly binaryPath: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd?: string;
}): Effect.Effect<CommandResult, Error, ChildProcessSpawner.ChildProcessSpawner> {
  return Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(
      ChildProcess.make(input.binaryPath, [...input.args], {
        ...(input.cwd ? { cwd: input.cwd } : {}),
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
    return {
      stdout,
      stderr,
      code: exitCode,
    } satisfies CommandResult;
  }).pipe(Effect.scoped);
}
