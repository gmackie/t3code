import type { SmolAgentSettings } from "@t3tools/contracts";
import { Effect, Layer, Scope } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import type * as EffectAcpErrors from "effect-acp/errors";

import {
  AcpSessionRuntime,
  type AcpSessionRuntimeOptions,
  type AcpSessionRuntimeShape,
  type AcpSpawnInput,
} from "./AcpSessionRuntime.ts";

type SmolAgentAcpRuntimeSettings = Pick<
  SmolAgentSettings,
  "binaryPath" | "llmProvider" | "host" | "apiKey"
>;

export interface SmolAgentAcpRuntimeInput extends Omit<
  AcpSessionRuntimeOptions,
  "authMethodId" | "spawn"
> {
  readonly childProcessSpawner: ChildProcessSpawner.ChildProcessSpawner["Service"];
  readonly smolAgentSettings: SmolAgentAcpRuntimeSettings | null | undefined;
  readonly model: string;
}

export function buildSmolAgentAcpSpawnInput(
  smolAgentSettings: SmolAgentAcpRuntimeSettings | null | undefined,
  cwd: string,
  model: string,
): AcpSpawnInput {
  const llmProvider = smolAgentSettings?.llmProvider.trim();
  const host = smolAgentSettings?.host.trim();
  const apiKey = smolAgentSettings?.apiKey.trim();
  return {
    command: smolAgentSettings?.binaryPath || "smol-agent",
    args: [
      ...(llmProvider ? (["--provider", llmProvider] as const) : []),
      ...(host ? (["--host", host] as const) : []),
      ...(apiKey ? (["--api-key", apiKey] as const) : []),
      ...(model.trim() ? (["--model", model.trim()] as const) : []),
      "--acp",
      "-d",
      cwd,
    ],
    cwd,
  };
}

export const makeSmolAgentAcpRuntime = (
  input: SmolAgentAcpRuntimeInput,
): Effect.Effect<AcpSessionRuntimeShape, EffectAcpErrors.AcpError, Scope.Scope> =>
  Effect.gen(function* () {
    const acpContext = yield* Layer.build(
      AcpSessionRuntime.layer({
        ...input,
        spawn: buildSmolAgentAcpSpawnInput(input.smolAgentSettings, input.cwd, input.model),
        authMethodId: "smol_bearer",
      }).pipe(
        Layer.provide(
          Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, input.childProcessSpawner),
        ),
      ),
    );
    return yield* Effect.service(AcpSessionRuntime).pipe(Effect.provide(acpContext));
  });
