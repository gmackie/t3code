import { assert, it } from "@effect/vitest";
import type { IssueLifecycleUpdateInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";

import { ServerSettingsService } from "../serverSettings.ts";
import * as IssueProvider from "./IssueProvider.ts";
import * as IssueProviderRegistry from "./IssueProviderRegistry.ts";
import * as IssueLifecycle from "./IssueLifecycle.ts";

function makeTestLifecycle() {
  return Effect.gen(function* () {
    const updatesRef = yield* Ref.make<Array<Omit<IssueLifecycleUpdateInput, "provider">>>([]);
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
      updateIssueLifecycle: (input) =>
        Ref.update(updatesRef, (updates) => [...updates, input]).pipe(
          Effect.as({ statusChanged: true }),
        ),
    });

    const registry = yield* IssueProviderRegistry.makeWithProviders([
      { kind: "linear", provider: linearProvider },
    ]).pipe(Effect.provide(ServerSettingsService.layerTest()));
    const lifecycle = yield* IssueLifecycle.make().pipe(
      Effect.provideService(IssueProviderRegistry.IssueProviderRegistry, registry),
    );

    return { lifecycle, updatesRef };
  });
}

it.effect("updates the Linear issue when an issue thread starts", () =>
  Effect.gen(function* () {
    const { lifecycle, updatesRef } = yield* makeTestLifecycle();

    yield* lifecycle.recordThreadStarted({
      provider: "linear",
      reference: "ENG-123",
      cwd: "/repo",
    });

    const updates = yield* Ref.get(updatesRef);
    assert.deepStrictEqual(updates, [
      {
        reference: "ENG-123",
        cwd: "/repo",
        event: "thread_started",
      },
    ]);
  }),
);

it.effect("updates the Linear issue when a change request is opened", () =>
  Effect.gen(function* () {
    const { lifecycle, updatesRef } = yield* makeTestLifecycle();

    yield* lifecycle.recordChangeRequestOpened({
      provider: "linear",
      reference: "ENG-123",
      cwd: "/repo",
      changeRequest: {
        provider: "github",
        number: 123,
        title: "Fix startup",
        url: "https://github.com/pingdotgg/t3code/pull/123",
        state: "open",
      },
    });

    const updates = yield* Ref.get(updatesRef);
    assert.strictEqual(updates[0]?.event, "change_request_opened");
    assert.strictEqual(updates[0]?.changeRequest?.number, 123);
  }),
);

it.effect("updates the Linear issue when webhook or polling observes a merged change request", () =>
  Effect.gen(function* () {
    const { lifecycle, updatesRef } = yield* makeTestLifecycle();

    yield* lifecycle.recordChangeRequestMerged({
      provider: "linear",
      reference: "ENG-123",
      cwd: "/repo",
      changeRequest: {
        provider: "github",
        number: 123,
        title: "Fix startup",
        url: "https://github.com/pingdotgg/t3code/pull/123",
        state: "merged",
      },
    });

    const updates = yield* Ref.get(updatesRef);
    assert.strictEqual(updates[0]?.event, "change_request_merged");
    assert.strictEqual(updates[0]?.changeRequest?.state, "merged");
  }),
);
