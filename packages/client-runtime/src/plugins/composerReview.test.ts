import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  gateComposerSend,
  resolveComposerReviewAction,
  shouldReviewComposerDraft,
  type ComposerReviewSuggestion,
} from "./composerReview.ts";

const suggestion: ComposerReviewSuggestion = {
  verdict: "suggest",
  pluginId: "skillfleet",
  tips: [{ pattern: "vague-goal", message: "Say what done looks like." }],
  rewrite: "Fix the failing login test and explain the root cause.",
};

const gateInput = { enabled: true, threadMuted: false, bypass: false, draft: "fix it" };

afterEach(() => {
  vi.useRealTimers();
});

describe("gateComposerSend", () => {
  it("sends immediately on pass", async () => {
    const review = vi.fn(async () => ({ verdict: "pass" }) as const);
    await expect(gateComposerSend({ ...gateInput, review })).resolves.toEqual({ kind: "send" });
    expect(review).toHaveBeenCalledOnce();
  });

  it("blocks the send when a plugin suggests", async () => {
    await expect(
      gateComposerSend({ ...gateInput, review: async () => suggestion }),
    ).resolves.toEqual({ kind: "suggest", suggestion });
  });

  it.each([suggestion, { verdict: "pass" } as const, null])(
    "discards a late result after the draft changes (%j)",
    async (result) => {
      const response = Promise.withResolvers<typeof result>();
      let current = true;
      const outcome = gateComposerSend({
        ...gateInput,
        review: () => response.promise,
        isCurrent: () => current,
      });
      current = false;
      response.resolve(result);
      await expect(outcome).resolves.toEqual({ kind: "cancel" });
    },
  );

  it("sends unchanged when the review misses the deadline", async () => {
    vi.useFakeTimers();
    const outcome = gateComposerSend({
      ...gateInput,
      review: () => new Promise(() => {}),
      timeoutMs: 1_500,
    });
    await vi.advanceTimersByTimeAsync(1_500);
    await expect(outcome).resolves.toEqual({ kind: "send" });
  });

  it("sends unchanged when the review fails or suggests nothing", async () => {
    await expect(
      gateComposerSend({
        ...gateInput,
        review: () => {
          throw new Error("offline");
        },
      }),
    ).resolves.toEqual({ kind: "send" });
    await expect(
      gateComposerSend({ ...gateInput, review: () => Promise.reject(new Error("offline")) }),
    ).resolves.toEqual({ kind: "send" });
    await expect(gateComposerSend({ ...gateInput, review: async () => null })).resolves.toEqual({
      kind: "send",
    });
    await expect(
      gateComposerSend({
        ...gateInput,
        review: async () => ({ verdict: "suggest", pluginId: "skillfleet", tips: [] }),
      }),
    ).resolves.toEqual({ kind: "send" });
  });

  it("skips review for a muted thread", async () => {
    const review = vi.fn(async () => suggestion);
    await expect(gateComposerSend({ ...gateInput, threadMuted: true, review })).resolves.toEqual({
      kind: "send",
    });
    expect(review).not.toHaveBeenCalled();
  });

  it("skips review for the submit that chose to send the original", async () => {
    const review = vi.fn(async () => suggestion);
    await expect(gateComposerSend({ ...gateInput, bypass: true, review })).resolves.toEqual({
      kind: "send",
    });
    expect(review).not.toHaveBeenCalled();
  });
});

describe("shouldReviewComposerDraft", () => {
  it("only reviews non-empty prose drafts while the setting is on", () => {
    expect(shouldReviewComposerDraft(gateInput)).toBe(true);
    expect(shouldReviewComposerDraft({ ...gateInput, enabled: false })).toBe(false);
    expect(shouldReviewComposerDraft({ ...gateInput, draft: "   " })).toBe(false);
    expect(shouldReviewComposerDraft({ ...gateInput, draft: " /compact" })).toBe(false);
    expect(shouldReviewComposerDraft({ ...gateInput, draft: "x".repeat(32_001) })).toBe(false);
  });
});

describe("resolveComposerReviewAction", () => {
  it("accept replaces the draft with the rewrite and sends it", () => {
    expect(resolveComposerReviewAction(suggestion, "accept")).toEqual({
      decision: "accepted",
      nextDraft: suggestion.rewrite,
      send: true,
      muteThread: false,
    });
  });

  it("send original sends the draft unchanged", () => {
    expect(resolveComposerReviewAction(suggestion, "original")).toEqual({
      decision: "original",
      nextDraft: null,
      send: true,
      muteThread: false,
    });
  });

  it("dismiss keeps the draft without sending", () => {
    expect(resolveComposerReviewAction(suggestion, "dismiss")).toMatchObject({
      decision: "dismissed",
      send: false,
      nextDraft: null,
    });
  });

  it("mute silences the thread and keeps the draft", () => {
    expect(resolveComposerReviewAction(suggestion, "mute")).toEqual({
      decision: "muted",
      nextDraft: null,
      send: false,
      muteThread: true,
    });
  });
});
