import {
  TaskProviderError,
  type TaskProviderDiscoveryItem,
  type TaskProviderKind,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ServerSettingsService } from "../serverSettings.ts";
import * as TaskProvider from "./TaskProvider.ts";

export interface TaskProviderRegistration {
  readonly kind: TaskProviderKind;
  readonly provider: TaskProvider.TaskProviderShape;
}

export interface TaskProviderRegistryShape {
  readonly get: (
    kind: TaskProviderKind,
  ) => Effect.Effect<TaskProvider.TaskProviderShape, TaskProviderError>;
  readonly discover: Effect.Effect<ReadonlyArray<TaskProviderDiscoveryItem>, TaskProviderError>;
}

export class TaskProviderRegistry extends Context.Service<
  TaskProviderRegistry,
  TaskProviderRegistryShape
>()("t3/task/TaskProviderRegistry") {}

function unsupportedProvider(kind: TaskProviderKind): TaskProvider.TaskProviderShape {
  const unsupported = (operation: string) =>
    Effect.fail(
      new TaskProviderError({
        provider: kind,
        operation,
        detail: `No ${kind} task provider is registered.`,
      }),
    );

  return TaskProvider.TaskProvider.of({
    kind,
    listTasks: () => unsupported("listTasks"),
    getTask: () => unsupported("getTask"),
    prepareTaskThread: () => unsupported("prepareTaskThread"),
  });
}

function linearDiscoveryItem(input: {
  readonly enabled: boolean;
  readonly apiToken: string;
}): TaskProviderDiscoveryItem {
  if (!input.enabled) {
    return {
      kind: "linear",
      label: "Linear",
      status: "disabled",
      detail: "Enable Linear task integration in settings.",
    };
  }

  if (input.apiToken.length === 0) {
    return {
      kind: "linear",
      label: "Linear",
      status: "missing-token",
      detail: "Set a Linear API token to use Linear tasks.",
    };
  }

  return {
    kind: "linear",
    label: "Linear",
    status: "available",
    detail: null,
  };
}

export const makeWithProviders = Effect.fn("makeTaskProviderRegistryWithProviders")(function* (
  registrations: ReadonlyArray<TaskProviderRegistration>,
) {
  const serverSettings = yield* ServerSettingsService;
  const providers = new Map<TaskProviderKind, TaskProvider.TaskProviderShape>(
    registrations.map((registration) => [registration.kind, registration.provider]),
  );

  return TaskProviderRegistry.of({
    get: (kind) => Effect.succeed(providers.get(kind) ?? unsupportedProvider(kind)),
    discover: serverSettings.getSettings.pipe(
      Effect.map((settings) => [
        linearDiscoveryItem({
          enabled: settings.tasks.linear.enabled,
          apiToken: settings.tasks.linear.apiToken,
        }),
      ]),
      Effect.mapError(
        (cause) =>
          new TaskProviderError({
            provider: "linear",
            operation: "discover",
            detail: "Failed to read task provider settings.",
            cause,
          }),
      ),
    ),
  });
});

export const make = Effect.fn("makeTaskProviderRegistry")(function* () {
  return yield* makeWithProviders([]);
});

export const layer = Layer.effect(TaskProviderRegistry, make());
