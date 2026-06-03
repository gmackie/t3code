import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { ServerSettingsService } from "../serverSettings.ts";
import * as TaskProvider from "./TaskProvider.ts";
import * as TaskProviderRegistry from "./TaskProviderRegistry.ts";

const linearProvider = TaskProvider.TaskProvider.of({
  kind: "linear",
  listTasks: () => Effect.succeed([]),
  getTask: () =>
    Effect.succeed({
      provider: "linear",
      id: "issue-id",
      key: "ENG-123",
      title: "Fix startup",
      url: "https://linear.app/acme/issue/ENG-123/fix-startup",
      state: "open",
      labels: [],
      comments: [],
    }),
  prepareTaskThread: () =>
    Effect.succeed({
      task: {
        provider: "linear",
        id: "issue-id",
        key: "ENG-123",
        title: "Fix startup",
        url: "https://linear.app/acme/issue/ENG-123/fix-startup",
        state: "open",
        labels: [],
        comments: [],
      },
      branch: "linear/eng-123-fix-startup",
      worktreePath: null,
      initialPrompt: "Task context",
    }),
});

function makeRegistry(settingsLayer = ServerSettingsService.layerTest()) {
  return TaskProviderRegistry.makeWithProviders([
    {
      kind: "linear",
      provider: linearProvider,
    },
  ]).pipe(Effect.provide(settingsLayer));
}

it.effect("routes directly by task provider kind", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry();

    const provider = yield* registry.get("linear");

    assert.strictEqual(provider.kind, "linear");
  }),
);

it.effect("returns an unsupported provider for unregistered task kinds", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry();

    const provider = yield* registry.get("jira");
    const exit = yield* provider.listTasks({}).pipe(Effect.exit);

    assert.strictEqual(provider.kind, "jira");
    assert.isTrue(exit._tag === "Failure");
  }),
);

it.effect("discovers Linear as disabled by default", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry();

    const providers = yield* registry.discover;

    assert.deepStrictEqual(providers, [
      {
        kind: "linear",
        label: "Linear",
        status: "disabled",
        detail: "Enable Linear task integration in settings.",
      },
    ]);
  }),
);

it.effect("discovers Linear as missing-token when enabled without an API token", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry(
      ServerSettingsService.layerTest({
        tasks: {
          linear: {
            enabled: true,
            apiToken: "",
            defaultTeamKey: "",
          },
        },
      }),
    );

    const providers = yield* registry.discover;

    assert.deepStrictEqual(providers, [
      {
        kind: "linear",
        label: "Linear",
        status: "missing-token",
        detail: "Set a Linear API token to use Linear tasks.",
      },
    ]);
  }),
);

it.effect("discovers Linear as available when enabled with an API token", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry(
      ServerSettingsService.layerTest({
        tasks: {
          linear: {
            enabled: true,
            apiToken: "lin_api_test",
            defaultTeamKey: "",
          },
        },
      }),
    );

    const providers = yield* registry.discover;

    assert.deepStrictEqual(providers, [
      {
        kind: "linear",
        label: "Linear",
        status: "available",
        detail: null,
      },
    ]);
  }),
);
