import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ServerConfig from "../config.ts";
import * as GitLabCli from "./GitLabCli.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import { make } from "./SourceControlProviderRegistry.ts";

it.effect("registers GitLab and rejects other source-control integrations", () =>
  Effect.gen(function* () {
    const registry = yield* make;
    expect((yield* registry.get("gitlab")).kind).toBe("gitlab");
    for (const kind of ["github", "forgejo", "azure-devops", "bitbucket"] as const) {
      const provider = yield* registry.get(kind);
      const result = yield* provider
        .listChangeRequests({ cwd: "/repo", state: "open", headSelector: "main" })
        .pipe(Effect.result);
      expect(result._tag).toBe("Failure");
    }
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        ServerConfig.layerTest(process.cwd(), { prefix: "t3-locked-integrations-" }).pipe(
          Layer.provide(NodeServices.layer),
        ),
        Layer.mock(GitLabCli.GitLabCli)({}),
        Layer.mock(VcsProcess.VcsProcess)({}),
        Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({}),
      ),
    ),
  ),
);
