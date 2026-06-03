import * as NodeOS from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { GrokBuildSettings } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { checkGrokBuildProviderStatus } from "./GrokBuildProvider.ts";

const decodeGrokBuildSettings = Schema.decodeSync(GrokBuildSettings);

const runNode = <A, E>(
  effect: Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
): Promise<A> => Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)));

const resolveMockAgentPath = Effect.fn("resolveMockAgentPath")(function* () {
  const path = yield* Path.Path;
  return yield* path.fromFileUrl(new URL("../../../scripts/acp-mock-agent.ts", import.meta.url));
});

const makeGrokMockWrapper = Effect.fn("makeGrokMockWrapper")(function* (
  extraEnv?: Record<string, string>,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const mockAgentPath = yield* resolveMockAgentPath();
  const dir = yield* fileSystem.makeTempDirectory({
    directory: NodeOS.tmpdir(),
    prefix: "grok-provider-mock-",
  });
  const wrapperPath = path.join(dir, "fake-grok.sh");
  const envExports = Object.entries(extraEnv ?? {})
    .map(([key, value]) => `export ${key}=${JSON.stringify(value)}`)
    .join("\n");
  // @effect-diagnostics-next-line preferSchemaOverJson:off
  const bunCommand = JSON.stringify("bun");
  // @effect-diagnostics-next-line preferSchemaOverJson:off
  const mockAgentPathJson = JSON.stringify(mockAgentPath);
  const script = `#!/bin/sh
if [ "$1" = "version" ]; then
  printf 'grok version 0.0.0-test\\n'
  exit 0
fi
${envExports}
exec ${bunCommand} ${mockAgentPathJson} "$@"
`;
  yield* fileSystem.writeFileString(wrapperPath, script);
  yield* fileSystem.chmod(wrapperPath, 0o755);
  return wrapperPath;
});

describe("checkGrokBuildProviderStatus", () => {
  it("discovers models from ACP session model state when no config options are exposed", async () => {
    const wrapperPath = await runNode(
      makeGrokMockWrapper({
        T3_ACP_SESSION_MODELS_ONLY: "1",
      }),
    );

    const provider = await Effect.runPromise(
      checkGrokBuildProviderStatus(
        decodeGrokBuildSettings({
          enabled: true,
          binaryPath: wrapperPath,
          customModels: [],
        }),
        process.cwd(),
      ).pipe(Effect.provide(NodeServices.layer)),
    );

    expect(provider.status).toBe("ready");
    expect(provider.models.map((model) => model.slug)).toEqual([
      "default",
      "composer-2",
      "grok-build",
    ]);
  });
});
