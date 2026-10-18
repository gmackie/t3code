import { SourceControlProviderKind } from "@t3tools/contracts";
/**
 * The ForgeGraph driver: repositories and pull requests through ForgeGraph's own HTTP API
 * (`/api/fg`), with no git-server CLI involved, for both of its pull request backends.
 *
 * @module source-control-forgegraph/server/driver
 */
import { defineSourceControlDriver } from "@t3tools/source-control-core/server/driver";
import * as Effect from "effect/Effect";

import * as ForgeGraphPullRequestProvider from "./ForgeGraphPullRequestProvider.ts";
import * as ForgeGraphSourceControlProvider from "./ForgeGraphSourceControlProvider.ts";

export const driver = defineSourceControlDriver({
  kind: SourceControlProviderKind.make("forgegraph"),
  make: Effect.all({
    sourceControl: ForgeGraphSourceControlProvider.make,
    discovery: ForgeGraphSourceControlProvider.makeDiscovery,
    pullRequests: ForgeGraphPullRequestProvider.make,
  }),
});
