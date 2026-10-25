import { SourceControlProviderKind } from "@t3tools/contracts";
/**
 * The ForgeGraph driver: repositories and pull requests through ForgeGraph's own HTTP API
 * (`/api/fg`), with no git-server CLI involved, for both of its pull request backends.
 *
 * Both providers read through one set of lookups, so a repository resolved for the branch's pull
 * request is not resolved again for its checks (T3CODE-53).
 *
 * @module source-control-forgegraph/server/driver
 */
import { defineSourceControlDriver } from "@t3tools/source-control-core/server/driver";
import * as Effect from "effect/Effect";

import * as ForgeGraphLookups from "./forgeGraphLookups.ts";
import * as ForgeGraphPullRequestProvider from "./ForgeGraphPullRequestProvider.ts";
import * as ForgeGraphSourceControlProvider from "./ForgeGraphSourceControlProvider.ts";

export const driver = defineSourceControlDriver({
  kind: SourceControlProviderKind.make("forgegraph"),
  make: Effect.gen(function* () {
    const lookups = yield* ForgeGraphLookups.make;
    return yield* Effect.all({
      sourceControl: ForgeGraphSourceControlProvider.makeWith(lookups),
      discovery: ForgeGraphSourceControlProvider.makeDiscovery,
      pullRequests: ForgeGraphPullRequestProvider.makeWith(lookups),
    });
  }),
});
