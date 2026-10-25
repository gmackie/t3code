import {
  defineSourceControlDriver,
  withOwnServices,
} from "@t3tools/source-control-core/server/driver";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { definition } from "../shared/definition.ts";

import * as ForgeGraphApi from "./ForgeGraphApi.ts";
import * as ForgeGraphCredentials from "./ForgeGraphCredentials.ts";
import * as ForgeGraphPullRequestProvider from "./ForgeGraphPullRequestProvider.ts";
import * as ForgeGraphSourceControlProvider from "./ForgeGraphSourceControlProvider.ts";

/** ForgeGraph's HTTP API (`/api/fg`) and the token it is read with. Sign-in builds its own. */
export const services = ForgeGraphApi.layer.pipe(Layer.provideMerge(ForgeGraphCredentials.layer));

const makeInstance = Effect.all({
  sourceControl: ForgeGraphSourceControlProvider.make,
  discovery: ForgeGraphSourceControlProvider.makeDiscovery,
  pullRequests: ForgeGraphPullRequestProvider.make,
});

export const driver = defineSourceControlDriver({
  kind: definition.kind,
  definition,
  make: withOwnServices(makeInstance, services),
});
