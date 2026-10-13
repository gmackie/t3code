import { expect, it } from "@effect/vitest";
import {
  ProviderInstanceId,
  ProviderDriverKind,
  ThreadId,
  ProviderSessionId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { ProviderAdapterV2Shape } from "../orchestration-v2/ProviderAdapter.ts";
import { restrictOpenCodeAdapter } from "./lockedDownAdapter.ts";

it.effect("rejects a direct request for an unapproved model before invoking OpenCode", () =>
  Effect.gen(function* () {
    let invoked = false;
    const adapter: ProviderAdapterV2Shape = {
      instanceId: ProviderInstanceId.make("opencode"),
      driver: ProviderDriverKind.make("opencode"),
      getCapabilities: () => Effect.die("unused"),
      planSelectionTransition: () => Effect.die("unused"),
      openSession: () => {
        invoked = true;
        return Effect.die("should not reach OpenCode");
      },
    };
    const restricted = restrictOpenCodeAdapter(
      adapter,
      new Set(["cloudflare-locked/workers-ai/@cf/approved"]),
    );
    const result = yield* restricted
      .openSession({
        threadId: ThreadId.make("test"),
        providerSessionId: ProviderSessionId.make("test"),
        modelSelection: { instanceId: adapter.instanceId, model: "openai/gpt-5", options: [] },
        runtimePolicy: { cwd: "/tmp", runtimeMode: "full-access", interactionMode: "default" },
      })
      .pipe(Effect.result, Effect.scoped);
    expect(result._tag).toBe("Failure");
    expect(invoked).toBe(false);
  }),
);

it.effect("rejects model changes after an approved session opens", () =>
  Effect.gen(function* () {
    let invoked = false;
    const denied = () => {
      invoked = true;
      return Effect.die("unapproved selection reached OpenCode");
    };
    const runtime = {
      ensureThread: denied,
      resumeThread: denied,
      forkThread: denied,
      startTurn: denied,
    } as unknown as import("../orchestration-v2/ProviderAdapter.ts").ProviderAdapterV2SessionRuntime;
    const adapter: ProviderAdapterV2Shape = {
      instanceId: ProviderInstanceId.make("opencode"),
      driver: ProviderDriverKind.make("opencode"),
      getCapabilities: () => Effect.die("unused"),
      planSelectionTransition: () => Effect.die("unused"),
      openSession: () => Effect.succeed(runtime),
    };
    const approved = "cloudflare-locked/workers-ai/@cf/approved";
    const restricted = restrictOpenCodeAdapter(adapter, new Set([approved]));
    const session = yield* restricted.openSession({
      threadId: ThreadId.make("test"),
      providerSessionId: ProviderSessionId.make("test"),
      modelSelection: { instanceId: adapter.instanceId, model: approved, options: [] },
      runtimePolicy: { cwd: "/tmp", runtimeMode: "full-access", interactionMode: "default" },
    });
    const result = yield* session
      .ensureThread({
        threadId: ThreadId.make("test"),
        modelSelection: { instanceId: adapter.instanceId, model: "openai/gpt-5", options: [] },
        runtimePolicy: { cwd: "/tmp", runtimeMode: "full-access", interactionMode: "default" },
      })
      .pipe(Effect.result);
    expect(result._tag).toBe("Failure");
    expect(invoked).toBe(false);
  }).pipe(Effect.scoped),
);
