import type { RoutingMetricRow } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  cacheHitRates,
  colorForLabel,
  downgradeStats,
  formatHoursToReset,
  hoursInRange,
  rowsInRange,
  stackByHour,
  totalsBySeries,
  windowViews,
} from "./routingOverview.logic";

const H0 = 1_788_706_800; // an hour start
const row = (hour: number, series: string, label: string, value: number): RoutingMetricRow => ({
  hour,
  series,
  label,
  value,
});

const rows: RoutingMetricRow[] = [
  row(H0, "decisions.source", "jev", 6),
  row(H0, "decisions.source", "fallback", 2),
  row(H0 + 3600, "decisions.source", "jev", 4),
  row(H0 + 3600, "decisions.source", "caller", 1),
  row(H0, "decisions.tier", "3", 7),
  row(H0 + 3600, "decisions.tier", "2", 5),
  row(H0, "decisions.downgrade", "extraction", 3),
  row(H0 + 3600, "decisions.downgrade", "review", 1),
  row(H0, "downgrade.outcome", "completed", 3),
  row(H0 + 3600, "downgrade.outcome", "failed", 1),
  row(H0, "tokens.input", "astra", 1000),
  row(H0, "tokens.cached", "astra", 860),
  row(H0 + 3600, "tokens.input", "luna", 500),
  row(H0 - 100 * 3600, "decisions.source", "jev", 999),
];

describe("hoursInRange", () => {
  it("ends at the current hour and covers the range", () => {
    const hours = hoursInRange(H0 + 1234, "24h");
    expect(hours).toHaveLength(24);
    expect(hours[23]).toBe(H0);
    expect(hours[0]).toBe(H0 - 23 * 3600);
    expect(hoursInRange(H0, "7d")).toHaveLength(168);
  });
});

describe("stackByHour", () => {
  it("pivots one series into legend-ordered columns and drops rows outside the range", () => {
    const hours = [H0, H0 + 3600];
    const stacked = stackByHour(rowsInRange(rows, hours), "decisions.source", hours);
    expect(stacked.labels).toEqual(["jev", "fallback", "caller"]);
    expect(stacked.columns).toEqual([
      { hour: H0, values: [6, 2, 0], total: 8 },
      { hour: H0 + 3600, values: [4, 0, 1], total: 5 },
    ]);
    expect(stacked.peak).toBe(8);
  });

  it("keeps a caller-supplied label order so colors do not move between ranges", () => {
    const stacked = stackByHour(rows, "decisions.source", [H0], ["caller", "jev"]);
    expect(stacked.columns[0]?.values).toEqual([0, 6]);
  });
});

describe("totalsBySeries", () => {
  it("sums each label largest first", () => {
    expect(totalsBySeries(rows, "decisions.tier")).toEqual([
      { label: "3", value: 7 },
      { label: "2", value: 5 },
    ]);
  });
});

describe("downgradeStats", () => {
  it("counts downgrades and the failed share of settled outcomes", () => {
    expect(downgradeStats(rows)).toEqual({
      downgrades: 4,
      completed: 3,
      failed: 1,
      failureRate: 0.25,
    });
  });

  it("has no failure rate before any outcome settles", () => {
    expect(downgradeStats([row(H0, "decisions.downgrade", "review", 2)]).failureRate).toBeNull();
  });
});

describe("cacheHitRates", () => {
  it("reports cached over input per model, most input first", () => {
    expect(cacheHitRates(rows)).toEqual([
      { model: "astra", inputTokens: 1000, cachedTokens: 860, rate: 0.86 },
      { model: "luna", inputTokens: 500, cachedTokens: 0, rate: 0 },
    ]);
  });
});

describe("windowViews", () => {
  it("orders by remaining and measures hours to reset", () => {
    const now = Date.parse("2026-09-06T12:00:00.000Z");
    const views = windowViews(
      [
        {
          id: "a",
          provider: "openai",
          account: "a",
          label: "weekly",
          remainingFraction: 0.8,
          observedAt: "2026-09-06T11:00:00.000Z",
          resetsAt: "2026-09-08T12:00:00.000Z",
        },
        {
          id: "b",
          provider: "anthropic",
          account: "b",
          label: "5h",
          remainingFraction: 0.149,
          observedAt: "2026-09-06T11:00:00.000Z",
          resetsAt: "2026-09-06T12:30:00.000Z",
        },
      ],
      now,
    );
    expect(views.map((view) => [view.window.id, view.remainingPercent, view.hoursToReset])).toEqual(
      [
        ["b", 15, 0.5],
        ["a", 80, 48],
      ],
    );
    expect(formatHoursToReset(0.5)).toBe("30 min to reset");
    expect(formatHoursToReset(47.6)).toBe("48 h to reset");
    expect(formatHoursToReset(48)).toBe("2 d to reset");
    expect(formatHoursToReset(-1)).toBe("resetting");
  });
});

describe("colorForLabel", () => {
  it("steps tiers on one hue and folds extra categories into grey", () => {
    expect(colorForLabel("decisions.tier", "3", 5)).toBe("#1c5cab");
    expect(colorForLabel("decisions.source", "jev", 0)).toBe("#2a78d6");
    expect(colorForLabel("decisions.model", "ninth", 8)).toBe("#8a8a85");
  });
});
