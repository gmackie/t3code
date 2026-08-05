import {
  ProviderInstanceId,
  type ProviderUsageSnapshot,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as ProviderService from "../Services/ProviderService.ts";
import * as ProviderUsageService from "../Services/ProviderUsageService.ts";
import { ProviderUsageCache, normalizeProviderRateLimits } from "../providerUsage.ts";

function providerInstanceIdForEvent(event: ProviderRuntimeEvent): ProviderInstanceId {
  return event.providerInstanceId ?? ProviderInstanceId.make(event.provider);
}

export const make = Effect.gen(function* () {
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const provider = yield* ProviderService.ProviderService;
  const environmentId = yield* environment.getEnvironmentId;
  const cache = new ProviderUsageCache(environmentId);
  const changes = yield* PubSub.unbounded<ProviderUsageSnapshot>();

  const snapshotFor = (providerInstanceId: ProviderInstanceId) =>
    provider.getInstanceInfo(providerInstanceId).pipe(
      Effect.map((info) => cache.get(providerInstanceId, info.driverKind)),
      Effect.catch(() => Effect.succeed(cache.get(providerInstanceId))),
    );

  const updateFromRuntimeEvent = (event: ProviderRuntimeEvent) => {
    if (event.type !== "account.rate-limits.updated") return Effect.void;

    const providerInstanceId = providerInstanceIdForEvent(event);
    const windows = normalizeProviderRateLimits(event.payload.rateLimits);
    const snapshot: ProviderUsageSnapshot = {
      environmentId,
      providerInstanceId,
      driverKind: event.provider,
      availability: windows.length > 0 ? "available" : "unavailable",
      windows,
      lastUpdatedAt: event.createdAt,
      source: "provider-event",
    };
    cache.set(snapshot);
    return PubSub.publish(changes, snapshot).pipe(Effect.asVoid);
  };

  yield* provider.streamEvents.pipe(Stream.runForEach(updateFromRuntimeEvent), Effect.forkScoped);

  return ProviderUsageService.ProviderUsageService.of({
    get: snapshotFor,
    refresh: (providerInstanceId) =>
      snapshotFor(providerInstanceId).pipe(
        Effect.map((snapshot) => ({ snapshot, refreshQueued: false })),
      ),
    stream: (providerInstanceId) =>
      Stream.concat(
        Stream.fromEffect(snapshotFor(providerInstanceId)),
        Stream.fromPubSub(changes).pipe(
          Stream.filter((snapshot) => snapshot.providerInstanceId === providerInstanceId),
        ),
      ),
    updateFromRuntimeEvent,
    streamChanges: Stream.fromPubSub(changes),
  });
});

export const layer = Layer.effect(ProviderUsageService.ProviderUsageService, make);
