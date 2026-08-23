import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderRuntimeEvent,
  type ProviderUsageWindow,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { describe, expect, it } from "@effect/vitest";

import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import { ProviderUnsupportedError } from "../Errors.ts";
import type { ProviderInstanceRoutingInfo } from "../Services/ProviderAdapterRegistry.ts";
import * as ProviderService from "../Services/ProviderService.ts";
import * as ProviderUsageService from "../Services/ProviderUsageService.ts";
import { layer } from "./ProviderUsageService.ts";

const INSTANCE_ID = ProviderInstanceId.make("cursor");
const QUERY_WINDOWS: ReadonlyArray<ProviderUsageWindow> = [
  {
    id: "included-usage",
    label: "Included usage",
    usedPercent: 40,
    remainingPercent: 60,
    resetsAt: "2026-08-23T01:21:23.000Z",
  },
];

const makeHarnessLayer = (options: {
  readonly queryResult: ReadonlyArray<ProviderUsageWindow> | undefined;
}) =>
  layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ServerEnvironment.ServerEnvironment)({
          getEnvironmentId: Effect.succeed(EnvironmentId.make("env-1")),
        }),
        Layer.mock(ProviderService.ProviderService)({
          getInstanceInfo: (instanceId) =>
            String(instanceId) === String(INSTANCE_ID)
              ? Effect.succeed<ProviderInstanceRoutingInfo>({
                  instanceId,
                  driverKind: ProviderDriverKind.make("cursor"),
                  displayName: undefined,
                  enabled: true,
                  continuationIdentity: {
                    driverKind: ProviderDriverKind.make("cursor"),
                    continuationKey: "driver:cursor",
                  },
                })
              : Effect.fail(new ProviderUnsupportedError({ provider: String(instanceId) })),
          queryInstanceUsage: () => Effect.succeed(options.queryResult),
          streamEvents: Stream.empty,
        }),
      ),
    ),
  );

const runWithHarness = <A>(
  options: { readonly queryResult: ReadonlyArray<ProviderUsageWindow> | undefined },
  body: (usage: ProviderUsageService.ProviderUsageService["Service"]) => Effect.Effect<A>,
) =>
  Effect.gen(function* () {
    const usage = yield* ProviderUsageService.ProviderUsageService;
    return yield* body(usage);
  }).pipe(Effect.provide(makeHarnessLayer(options)));

describe("ProviderUsageService refresh", () => {
  it.effect("queries fresh quota for the first subscription snapshot", () =>
    runWithHarness({ queryResult: QUERY_WINDOWS }, (usage) =>
      Effect.gen(function* () {
        const first = yield* usage.stream(INSTANCE_ID).pipe(Stream.runHead);

        expect(Option.getOrUndefined(first)?.source).toBe("provider-query");
        expect(Option.getOrUndefined(first)?.windows).toEqual(QUERY_WINDOWS);
      }),
    ),
  );

  it.effect("publishes a provider-query snapshot when the adapter returns fresh windows", () =>
    runWithHarness({ queryResult: QUERY_WINDOWS }, (usage) =>
      Effect.gen(function* () {
        const result = yield* usage.refresh(INSTANCE_ID);
        expect(result.refreshQueued).toBe(false);
        expect(result.snapshot.source).toBe("provider-query");
        expect(result.snapshot.availability).toBe("available");
        expect(result.snapshot.driverKind).toBe("cursor");
        expect(result.snapshot.windows).toEqual(QUERY_WINDOWS);

        // The fresh snapshot must be cached for subsequent reads.
        const cached = yield* usage.get(INSTANCE_ID);
        expect(cached.source).toBe("provider-query");
        expect(cached.windows).toEqual(QUERY_WINDOWS);
      }),
    ),
  );

  it.effect("falls back to the cached snapshot when the adapter has no query capability", () =>
    runWithHarness({ queryResult: undefined }, (usage) =>
      Effect.gen(function* () {
        const result = yield* usage.refresh(INSTANCE_ID);
        expect(result.refreshQueued).toBe(false);
        expect(result.snapshot.source).toBe("unavailable");
        expect(result.snapshot.availability).toBe("unavailable");
      }),
    ),
  );

  it.effect("falls back to the cached snapshot when the adapter reports no usage data", () =>
    runWithHarness({ queryResult: [] }, (usage) =>
      Effect.gen(function* () {
        const event: ProviderRuntimeEvent = {
          type: "account.rate-limits.updated",
          eventId: "event-1",
          provider: ProviderDriverKind.make("cursor"),
          providerInstanceId: INSTANCE_ID,
          threadId: "thread-1",
          createdAt: "2026-08-17T00:00:00.000Z",
          payload: {
            rateLimits: [{ id: "included-usage", label: "Included usage", usedPercent: 10 }],
          },
        } as ProviderRuntimeEvent;
        yield* usage.updateFromRuntimeEvent(event);

        const result = yield* usage.refresh(INSTANCE_ID);
        expect(result.snapshot.source).toBe("provider-event");
        expect(result.snapshot.windows.map((window) => window.id)).toEqual(["included-usage"]);
      }),
    ),
  );
});
