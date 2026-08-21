import {
  ProviderInstanceId,
  type ProviderUsageSnapshot,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
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
      Effect.orElseSucceed(() => cache.get(providerInstanceId)),
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

  // On-demand refresh: ask the adapter for fresh usage. Adapters without a
  // queryUsage capability (event-driven providers) and query failures both
  // fall back to the cached snapshot, so refresh never errors to the client.
  const refresh = (providerInstanceId: ProviderInstanceId) =>
    Effect.gen(function* () {
      const windows = yield* provider
        .queryInstanceUsage(providerInstanceId)
        .pipe(Effect.orElseSucceed(() => undefined));
      if (windows === undefined || windows.length === 0) {
        const snapshot = yield* snapshotFor(providerInstanceId);
        return { snapshot, refreshQueued: false };
      }
      const driverKind = yield* provider.getInstanceInfo(providerInstanceId).pipe(
        Effect.map((info) => info.driverKind),
        Effect.orElseSucceed(() => cache.get(providerInstanceId).driverKind),
      );
      const snapshot: ProviderUsageSnapshot = {
        environmentId,
        providerInstanceId,
        driverKind,
        availability: "available",
        windows,
        lastUpdatedAt: DateTime.formatIso(yield* DateTime.now),
        source: "provider-query",
      };
      cache.set(snapshot);
      yield* PubSub.publish(changes, snapshot);
      return { snapshot, refreshQueued: false };
    });

  return ProviderUsageService.ProviderUsageService.of({
    get: snapshotFor,
    refresh,
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
