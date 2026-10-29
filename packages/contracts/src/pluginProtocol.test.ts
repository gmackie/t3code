import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { PluginCapabilityRequest } from "./pluginCapabilities.ts";
import {
  PLUGIN_COMPOSER_REVIEW_MAX_DRAFT_CHARS,
  PluginComposerReviewDecisionInput,
  PluginComposerReviewInput,
  PluginComposerReviewResult,
  PluginComposerReviewVerdict,
  PluginManifest,
} from "./pluginProtocol.ts";

const decodeVerdict = Schema.decodeUnknownSync(PluginComposerReviewVerdict);
const isVerdict = Schema.is(PluginComposerReviewVerdict);
const isReviewInput = Schema.is(PluginComposerReviewInput);
const isReviewResult = Schema.is(PluginComposerReviewResult);
const isDecisionInput = Schema.is(PluginComposerReviewDecisionInput);
const isCapability = Schema.is(PluginCapabilityRequest);
const decodeManifest = Schema.decodeUnknownSync(PluginManifest);
const tip = { pattern: "vague-goal", message: "Say what done looks like." };

describe("composer review contracts", () => {
  it("accepts a composer.review capability in a manifest with the beforeSubmit hook", () => {
    const manifest = decodeManifest({
      schemaVersion: 1,
      id: "skillfleet",
      displayName: "Skillfleet",
      version: "1.0.0",
      runtime: { kind: "managed-app", command: ["skillfleet", "t3"], restart: "on-failure" },
      contributes: { hooks: ["composer.beforeSubmit"] },
      capabilities: [{ kind: "composer.review" }],
    });
    expect(manifest.capabilities).toEqual([{ kind: "composer.review" }]);
    expect(isCapability({ kind: "composer.review" })).toBe(true);
  });

  it("caps the draft sent to plugins", () => {
    const input = { threadId: "thread-1", projectRoot: null, providerModel: null, draft: "hi" };
    expect(isReviewInput(input)).toBe(true);
    expect(
      isReviewInput({ ...input, draft: "x".repeat(PLUGIN_COMPOSER_REVIEW_MAX_DRAFT_CHARS + 1) }),
    ).toBe(false);
    expect(isReviewInput({ ...input, projectRoot: undefined })).toBe(false);
  });

  it("decodes pass and suggest verdicts", () => {
    expect(decodeVerdict({ verdict: "pass" })).toEqual({ verdict: "pass" });
    expect(decodeVerdict({ verdict: "suggest", tips: [tip], rewrite: "Better prompt" })).toEqual({
      verdict: "suggest",
      tips: [tip],
      rewrite: "Better prompt",
    });
    expect(decodeVerdict({ verdict: "suggest", tips: [tip] })).toEqual({
      verdict: "suggest",
      tips: [tip],
    });
  });

  it("rejects malformed verdicts", () => {
    expect(isVerdict({ verdict: "block" })).toBe(false);
    expect(isVerdict({ verdict: "suggest" })).toBe(false);
    expect(isVerdict({ verdict: "suggest", tips: Array.from({ length: 6 }, () => tip) })).toBe(
      false,
    );
    expect(isVerdict({ verdict: "suggest", tips: [{ pattern: "x" }] })).toBe(false);
  });

  it("names the plugin that suggested in merged results", () => {
    expect(isReviewResult({ verdict: "suggest", pluginId: "skillfleet", tips: [tip] })).toBe(true);
    expect(isReviewResult({ verdict: "suggest", tips: [tip] })).toBe(false);
  });

  it("accepts only known review decisions", () => {
    const input = { pluginId: "skillfleet", threadId: "thread-1", decision: "accepted" };
    expect(isDecisionInput(input)).toBe(true);
    expect(isDecisionInput({ ...input, decision: "muted" })).toBe(true);
    expect(isDecisionInput({ ...input, decision: "ignored" })).toBe(false);
  });
});
