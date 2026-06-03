import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { ServerSettingsService } from "../serverSettings.ts";
import * as IssueProvider from "./IssueProvider.ts";
import * as IssueProviderRegistry from "./IssueProviderRegistry.ts";

const linearProvider = IssueProvider.IssueProvider.of({
  kind: "linear",
  listIssues: () => Effect.succeed([]),
  getIssue: () =>
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
  prepareIssueThread: () =>
    Effect.succeed({
      issue: {
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
      initialPrompt: "Issue context",
    }),
  updateIssueLifecycle: () => Effect.succeed({ statusChanged: false }),
});

function makeRegistry(settingsLayer = ServerSettingsService.layerTest()) {
  return IssueProviderRegistry.makeWithProviders([
    {
      kind: "linear",
      provider: linearProvider,
    },
  ]).pipe(Effect.provide(settingsLayer));
}

it.effect("routes directly by issue provider kind", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry();

    const provider = yield* registry.get("linear");

    assert.strictEqual(provider.kind, "linear");
  }),
);

it.effect("returns an unsupported provider for unregistered issue kinds", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry();

    const provider = yield* registry.get("jira");
    const exit = yield* provider.listIssues({}).pipe(Effect.exit);
    const updateExit = yield* provider
      .updateIssueLifecycle({
        reference: "JIRA-123",
        cwd: "/repo",
        event: "change_request_opened",
      })
      .pipe(Effect.exit);

    assert.strictEqual(provider.kind, "jira");
    assert.isTrue(exit._tag === "Failure");
    assert.isTrue(updateExit._tag === "Failure");
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
        detail: "Enable Linear issue integration in settings.",
      },
    ]);
  }),
);

it.effect("discovers Linear as missing-token when enabled without an API token", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry(
      ServerSettingsService.layerTest({
        issues: {
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
        detail: "Set a Linear API token to use Linear issues.",
      },
    ]);
  }),
);

it.effect("discovers Linear as available when enabled with an API token", () =>
  Effect.gen(function* () {
    const registry = yield* makeRegistry(
      ServerSettingsService.layerTest({
        issues: {
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
