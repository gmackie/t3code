import { ProviderInstanceId, ThreadId, type RoutingDecision } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  formatRoutingAdvice,
  formatRoutingBadgeLabel,
  formatRoutingDecision,
  formatRoutingSource,
  latestRoutingDecision,
  shouldShowRoutingBadge,
} from "./RoutingBadge.logic";

const decision: RoutingDecision = {
  requestId: "req-1",
  at: "2026-09-06T15:00:10.500Z",
  model: "sol",
  label: "Sol",
  tier: 2,
  kind: "extraction",
  confidence: 0.92,
  source: "jev",
  turn: "continuation",
  downgraded: true,
  advice: "compact",
  reasons: ["jev extraction 0.92"],
};

describe("RoutingBadge logic", () => {
  it("only shows for the pistache instance", () => {
    expect(shouldShowRoutingBadge(ProviderInstanceId.make("pistache"))).toBe(true);
    expect(shouldShowRoutingBadge(ProviderInstanceId.make("opencode"))).toBe(false);
    expect(shouldShowRoutingBadge(null)).toBe(false);
  });

  it("takes the newest decision only when the router is configured", () => {
    const threadId = ThreadId.make("thread-a");
    const older = { ...decision, requestId: "req-0", at: "2026-09-06T14:00:00.000Z" };
    expect(
      latestRoutingDecision({ configured: true, threadId, decisions: [decision, older] }),
    ).toBe(decision);
    expect(latestRoutingDecision({ configured: true, threadId, decisions: [] })).toBeNull();
    expect(
      latestRoutingDecision({ configured: false, threadId, decisions: [decision] }),
    ).toBeNull();
    expect(latestRoutingDecision(null)).toBeNull();
  });

  it("formats the decision the way the router titles it", () => {
    expect(formatRoutingDecision(decision)).toBe("Routed to Sol (tier 2) · extraction 0.92");
    expect(formatRoutingBadgeLabel(decision)).toBe("Sol · T2");
    expect(formatRoutingSource(decision)).toBe("jev · continuation");
    expect(formatRoutingSource({ ...decision, turn: "user" })).toBe("jev · user turn");
  });

  it("explains advice and stays quiet without it", () => {
    expect(formatRoutingAdvice("compact")).toContain("compacting");
    expect(formatRoutingAdvice("handoff")).toContain("switching models");
    expect(formatRoutingAdvice(null)).toBeNull();
  });
});
