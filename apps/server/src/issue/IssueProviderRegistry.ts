import {
  IssueProviderError,
  type IssueProviderDiscoveryItem,
  type IssueProviderKind,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ServerSettingsService } from "../serverSettings.ts";
import * as IssueProvider from "./IssueProvider.ts";

export interface IssueProviderRegistration {
  readonly kind: IssueProviderKind;
  readonly provider: IssueProvider.IssueProviderShape;
}

export interface IssueProviderRegistryShape {
  readonly get: (
    kind: IssueProviderKind,
  ) => Effect.Effect<IssueProvider.IssueProviderShape, IssueProviderError>;
  readonly discover: Effect.Effect<ReadonlyArray<IssueProviderDiscoveryItem>, IssueProviderError>;
}

export class IssueProviderRegistry extends Context.Service<
  IssueProviderRegistry,
  IssueProviderRegistryShape
>()("t3/issue/IssueProviderRegistry") {}

function unsupportedProvider(kind: IssueProviderKind): IssueProvider.IssueProviderShape {
  const unsupported = (operation: string) =>
    Effect.fail(
      new IssueProviderError({
        provider: kind,
        operation,
        detail: `No ${kind} issue provider is registered.`,
      }),
    );

  return IssueProvider.IssueProvider.of({
    kind,
    listIssues: () => unsupported("listIssues"),
    getIssue: () => unsupported("getIssue"),
    prepareIssueThread: () => unsupported("prepareIssueThread"),
  });
}

function linearDiscoveryItem(input: {
  readonly enabled: boolean;
  readonly apiToken: string;
}): IssueProviderDiscoveryItem {
  if (!input.enabled) {
    return {
      kind: "linear",
      label: "Linear",
      status: "disabled",
      detail: "Enable Linear issue integration in settings.",
    };
  }

  if (input.apiToken.length === 0) {
    return {
      kind: "linear",
      label: "Linear",
      status: "missing-token",
      detail: "Set a Linear API token to use Linear issues.",
    };
  }

  return {
    kind: "linear",
    label: "Linear",
    status: "available",
    detail: null,
  };
}

export const makeWithProviders = Effect.fn("makeIssueProviderRegistryWithProviders")(function* (
  registrations: ReadonlyArray<IssueProviderRegistration>,
) {
  const serverSettings = yield* ServerSettingsService;
  const providers = new Map<IssueProviderKind, IssueProvider.IssueProviderShape>(
    registrations.map((registration) => [registration.kind, registration.provider]),
  );

  return IssueProviderRegistry.of({
    get: (kind) => Effect.succeed(providers.get(kind) ?? unsupportedProvider(kind)),
    discover: serverSettings.getSettings.pipe(
      Effect.map((settings) => [
        linearDiscoveryItem({
          enabled: settings.issues.linear.enabled,
          apiToken: settings.issues.linear.apiToken,
        }),
      ]),
      Effect.mapError(
        (cause) =>
          new IssueProviderError({
            provider: "linear",
            operation: "discover",
            detail: "Failed to read issue provider settings.",
            cause,
          }),
      ),
    ),
  });
});

export const make = Effect.fn("makeIssueProviderRegistry")(function* () {
  return yield* makeWithProviders([]);
});

export const layer = Layer.effect(IssueProviderRegistry, make());
