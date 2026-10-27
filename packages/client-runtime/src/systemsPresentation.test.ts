import type { SystemsSignalSeries } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { plotSignals } from "./systemsPresentation.ts";

const point = (
  seconds: number,
  value: number | boolean,
  side: "initial" | "pre" | "post" = "post",
) => ({
  time: { num: String(seconds), den: "1" },
  seconds,
  side,
  value,
});

const series = (signalId: string, points: SystemsSignalSeries["points"]): SystemsSignalSeries => ({
  signalId,
  unit: "1",
  resolution: "raw",
  totalSamples: points.length,
  points,
});

describe("plotSignals", () => {
  it("draws a pre/post pair at one time as a vertical jump", () => {
    const plot = plotSignals(
      [series("level", [point(0, 0, "initial"), point(1, 0, "pre"), point(1, 2), point(2, 2)])],
      { width: 100, height: 10 },
    );
    expect(plot.series[0]!.path).toBe("M0 10 H50 V10 H50 V0 H100 V0 H100");
  });

  it("plots booleans as 0/1 on a shared time axis", () => {
    const plot = plotSignals(
      [series("pump_enabled", [point(0, false), point(4, true)]), series("level", [point(2, 5)])],
      { width: 40, height: 10 },
    );
    expect([plot.t0, plot.t1]).toEqual([0, 4]);
    expect(plot.series[0]).toMatchObject({ min: 0, max: 1, path: "M0 10 H40 V0 H40" });
    // A constant signal sits mid-box.
    expect(plot.series[1]!.path).toBe("M20 5 H40");
  });
});
