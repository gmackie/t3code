import type {
  ProviderInstanceId,
  ProviderRuntimeEvent,
  ProviderUsageRefreshResult,
  ProviderUsageSnapshot,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";

export interface ProviderUsageServiceShape {
  readonly get: (providerInstanceId: ProviderInstanceId) => Effect.Effect<ProviderUsageSnapshot>;
  readonly refresh: (
    providerInstanceId: ProviderInstanceId,
  ) => Effect.Effect<ProviderUsageRefreshResult>;
  readonly stream: (providerInstanceId: ProviderInstanceId) => Stream.Stream<ProviderUsageSnapshot>;
  readonly updateFromRuntimeEvent: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
  readonly streamChanges: Stream.Stream<ProviderUsageSnapshot>;
}

export class ProviderUsageService extends Context.Service<
  ProviderUsageService,
  ProviderUsageServiceShape
>()("t3/provider/Services/ProviderUsageService") {}
