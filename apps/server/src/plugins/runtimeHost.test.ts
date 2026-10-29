import type { PluginManifest, PluginRpcRequest, PluginRpcResponse } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { PluginLifecycle } from "./lifecycle.ts";
import { PluginRuntimeHost } from "./runtimeHost.ts";
import { PluginRuntimeSupervisor, type ManagedPluginLauncher } from "./runtimeSupervisor.ts";

type Responder = (message: PluginRpcRequest) => Promise<unknown>;

const reviewInput = {
  threadId: "thread-1",
  projectRoot: "/repo",
  providerModel: "claude-opus",
  draft: "fix it",
};

function manifest(
  id: string,
  options: { capability?: boolean; hook?: boolean } = {},
): PluginManifest {
  return {
    schemaVersion: 1,
    id,
    displayName: id,
    version: "1.0.0",
    runtime: { kind: "managed-app", command: [id], restart: "never" },
    contributes: options.hook === false ? {} : { hooks: ["composer.beforeSubmit"] },
    capabilities: options.capability === false ? [] : [{ kind: "composer.review" }],
  };
}

async function setup(
  plugins: ReadonlyArray<{ manifest: PluginManifest; respond: Responder }>,
  options?: { composerReviewTimeoutMs?: number },
) {
  const calls: Array<{ pluginId: string; message: PluginRpcRequest }> = [];
  const respondersByCommand = new Map(
    plugins.map((plugin) => [plugin.manifest.id, plugin] as const),
  );
  const launcher: ManagedPluginLauncher = {
    async start(command) {
      const plugin = respondersByCommand.get(command[0]!)!;
      return {
        stop: async () => {},
        request: async (message): Promise<PluginRpcResponse> => {
          calls.push({ pluginId: plugin.manifest.id, message });
          try {
            const result = await plugin.respond(message);
            return { type: "plugin.response", requestId: message.requestId, ok: true, result };
          } catch (error) {
            return {
              type: "plugin.response",
              requestId: message.requestId,
              ok: false,
              error: String(error),
            };
          }
        },
      };
    },
  };
  const lifecycle = new PluginLifecycle();
  const host = new PluginRuntimeHost(lifecycle, new PluginRuntimeSupervisor(launcher), options);
  for (const plugin of plugins) {
    lifecycle.install({
      manifest: plugin.manifest,
      source: { kind: "catalog", id: plugin.manifest.id },
    });
    for (const capability of plugin.manifest.capabilities) {
      lifecycle.grant(plugin.manifest.id, capability);
    }
    await host.enable(plugin.manifest.id);
  }
  return { host, calls, lifecycle };
}

const tip = (pattern: string) => ({ pattern, message: `tip ${pattern}` });

afterEach(() => {
  vi.useRealTimers();
});

describe("PluginRuntimeHost.composerReview", () => {
  it("passes without calling anything when no plugin reviews drafts", async () => {
    const respond = vi.fn<Responder>(async () => ({ verdict: "suggest", tips: [tip("a")] }));
    const { host, calls } = await setup([
      { manifest: manifest("no-hook", { hook: false }), respond },
      { manifest: manifest("no-capability", { capability: false }), respond },
    ]);

    expect(await host.composerReview(reviewInput)).toEqual({ verdict: "pass" });
    expect(calls).toEqual([]);
  });

  it("sends the draft as a composer.review request and names the suggesting plugin", async () => {
    const { host, calls } = await setup([
      {
        manifest: manifest("skillfleet"),
        respond: async () => ({ verdict: "suggest", tips: [tip("vague")], rewrite: "Fix X" }),
      },
    ]);

    expect(await host.composerReview(reviewInput)).toEqual({
      verdict: "suggest",
      pluginId: "skillfleet",
      tips: [tip("vague")],
      rewrite: "Fix X",
    });
    expect(calls.map((call) => call.message)).toEqual([
      expect.objectContaining({
        type: "plugin.request",
        method: "composer.review",
        payload: reviewInput,
      }),
    ]);
  });

  it("treats a reviewer that misses the deadline as a pass", async () => {
    vi.useFakeTimers();
    const { host } = await setup(
      [{ manifest: manifest("slow"), respond: () => new Promise(() => {}) }],
      { composerReviewTimeoutMs: 1_500 },
    );

    const review = host.composerReview(reviewInput);
    await vi.advanceTimersByTimeAsync(1_500);

    expect(await review).toEqual({ verdict: "pass" });
  });

  it("treats errors and malformed verdicts as a pass", async () => {
    const { host } = await setup([
      {
        manifest: manifest("broken"),
        respond: async () => {
          throw new Error("boom");
        },
      },
      { manifest: manifest("malformed"), respond: async () => ({ verdict: "block" }) },
      { manifest: manifest("empty"), respond: async () => ({ verdict: "suggest", tips: [] }) },
    ]);

    expect(await host.composerReview(reviewInput)).toEqual({ verdict: "pass" });
  });

  it("keeps the first suggestion in install order, even when a later plugin answers first", async () => {
    let releaseFirst: () => void = () => {};
    const firstAnswered = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const { host, calls } = await setup([
      { manifest: manifest("passes"), respond: async () => ({ verdict: "pass" }) },
      {
        manifest: manifest("first"),
        respond: async () => {
          await firstAnswered;
          return { verdict: "suggest", tips: [tip("first")] };
        },
      },
      {
        manifest: manifest("second"),
        respond: async () => {
          releaseFirst();
          return { verdict: "suggest", tips: [tip("second")], rewrite: "second rewrite" };
        },
      },
    ]);

    expect(await host.composerReview(reviewInput)).toEqual({
      verdict: "suggest",
      pluginId: "first",
      tips: [tip("first")],
    });
    expect(calls.map((call) => call.pluginId).toSorted()).toEqual(["first", "passes", "second"]);
  });

  it("skips reviewers that are not running", async () => {
    const respond = vi.fn<Responder>(async () => ({ verdict: "suggest", tips: [tip("a")] }));
    const { host, calls } = await setup([{ manifest: manifest("stopped"), respond }]);
    await host.disable("stopped");

    expect(await host.composerReview(reviewInput)).toEqual({ verdict: "pass" });
    expect(calls).toEqual([]);
  });

  it("stops sharing drafts when permission is revoked while the process is still running", async () => {
    const { host, calls, lifecycle } = await setup([
      { manifest: manifest("revoked"), respond: async () => ({ verdict: "pass" }) },
    ]);
    lifecycle.revoke("revoked", { kind: "composer.review" });

    expect(await host.composerReview(reviewInput)).toEqual({ verdict: "pass" });
    await host.composerReviewDecision({
      pluginId: "revoked",
      threadId: "thread-1",
      decision: "original",
    });
    expect(calls).toEqual([]);
  });
});

describe("PluginRuntimeHost.composerReviewDecision", () => {
  it("forwards the decision to the reviewing plugin and swallows its errors", async () => {
    const { host, calls } = await setup([
      {
        manifest: manifest("skillfleet"),
        respond: async () => {
          throw new Error("unavailable");
        },
      },
    ]);
    const decision = { pluginId: "skillfleet", threadId: "thread-1", decision: "muted" } as const;

    await expect(host.composerReviewDecision(decision)).resolves.toBeUndefined();
    expect(calls.map((call) => call.message)).toEqual([
      expect.objectContaining({ method: "composer.reviewDecision", payload: decision }),
    ]);
  });

  it("does not forward decisions to plugins that never review drafts", async () => {
    const respond = vi.fn<Responder>(async () => null);
    const { host, calls } = await setup([
      { manifest: manifest("other", { hook: false }), respond },
    ]);

    await host.composerReviewDecision({
      pluginId: "other",
      threadId: "thread-1",
      decision: "accepted",
    });
    expect(calls).toEqual([]);
  });
});
