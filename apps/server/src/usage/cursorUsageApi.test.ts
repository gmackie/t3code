import { describe, expect, it } from "@effect/vitest";

import {
  cursorAccountId,
  cursorAuthFilePath,
  parseCursorUsageEventsPage,
} from "./cursorUsageApi.ts";

/** Shaped after a real `GetFilteredUsageEvents` response. */
function eventsPage(overrides?: { events?: readonly unknown[]; totalCount?: number }): unknown {
  return {
    totalUsageEventsCount: overrides?.totalCount ?? 127,
    usageEventsDisplay: overrides?.events ?? [
      {
        timestamp: "1786971921018",
        model: "cursor-grok-4.6-high-fast",
        kind: "USAGE_EVENT_KIND_INCLUDED_IN_PRO",
        requestsCosts: 38.9,
        isTokenBasedCall: true,
        tokenUsage: {
          inputTokens: 25741,
          outputTokens: 6474,
          cacheReadTokens: 1374336,
          totalCents: 155.4988,
          discountPercentOff: 50,
        },
        owningUser: "170497513",
        chargedCents: 77.7494,
        conversationId: "49a5328f-108c-407c-aba2-290879ccef60",
        subscriptionProductId: "pro-legacy",
      },
    ],
  };
}

describe("parseCursorUsageEventsPage", () => {
  it("maps an event onto the shared record shape with pre-discount cost", () => {
    const page = parseCursorUsageEventsPage(eventsPage());
    expect(page.totalCount).toBe(127);
    expect(page.eventCount).toBe(1);
    expect(page.records).toHaveLength(1);
    expect(page.records[0]).toMatchObject({
      provider: "cursor",
      timestampMs: 1786971921018,
      model: "cursor-grok-4.6-high-fast",
      sessionId: "49a5328f-108c-407c-aba2-290879ccef60",
      totals: {
        uncachedInputTokens: 25741,
        cachedInputTokens: 1374336,
        cacheCreationTokens: 0,
        outputTokens: 6474,
        reasoningTokens: 0,
      },
    });
    // `totalCents` is the raw API-equivalent cost; `chargedCents` (post plan
    // discount) is deliberately ignored.
    expect(page.records[0]?.reportedCostUsd).toBeCloseTo(1.554988, 6);
    expect(page.records[0]?.dedupeKey).toContain("1786971921018");
  });

  it("counts but does not record events without usable token data", () => {
    const page = parseCursorUsageEventsPage(
      eventsPage({
        events: [
          { timestamp: "1786971921018", model: "gpt-5.4-mini" },
          {
            timestamp: "1786971921019",
            model: "composer-2.5-fast",
            tokenUsage: { inputTokens: 10, outputTokens: 1, totalCents: 0.5 },
            conversationId: "c-1",
          },
        ],
        totalCount: 2,
      }),
    );
    expect(page.eventCount).toBe(2);
    expect(page.records).toHaveLength(1);
    expect(page.records[0]?.model).toBe("composer-2.5-fast");
  });

  it("returns an empty page for malformed payloads", () => {
    expect(parseCursorUsageEventsPage(null)).toEqual({ records: [], eventCount: 0, totalCount: 0 });
    expect(parseCursorUsageEventsPage({ usageEventsDisplay: "nope" })).toMatchObject({
      records: [],
      eventCount: 0,
    });
  });
});

describe("cursorAccountId", () => {
  it("reads the JWT sub claim without verifying the signature", () => {
    const payload = Buffer.from(JSON.stringify({ sub: "github|user_123" })).toString("base64url");
    expect(cursorAccountId(`header.${payload}.signature`)).toBe("github|user_123");
  });

  it("returns null for opaque tokens", () => {
    expect(cursorAccountId("not-a-jwt")).toBeNull();
    expect(cursorAccountId("a.%%%.c")).toBeNull();
  });
});

describe("cursorAuthFilePath", () => {
  it("resolves the CLI's per-platform auth.json location", () => {
    expect(cursorAuthFilePath("darwin", {})).toMatch(/\.cursor\/auth\.json$/);
    expect(cursorAuthFilePath("linux", { XDG_CONFIG_HOME: "/xdg" })).toBe("/xdg/cursor/auth.json");
    expect(cursorAuthFilePath("win32", { APPDATA: "/appdata" })).toMatch(
      /appdata[/\\]Cursor[/\\]auth\.json$/,
    );
  });
});
