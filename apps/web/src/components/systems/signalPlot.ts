import type { SystemsSignalSeries } from "@t3tools/contracts";

/** An exact rational time as a short decimal-or-fraction label. */
export const formatTime = (time: { readonly num: string; readonly den: string }) =>
  time.den === "1" ? time.num : `${time.num}/${time.den}`;

/**
 * Static step-plot geometry for downsampled signal series. Values hold until the next
 * point, so a `pre` and a `post` sample at one time draw as a vertical jump. Booleans
 * plot as 0 and 1. Pure, so the SVG renders once per response and never repaints.
 */

export interface PlotBox {
  readonly width: number;
  readonly height: number;
}

export interface PlottedSeries {
  readonly signalId: string;
  readonly unit: string;
  readonly path: string;
  readonly min: number;
  readonly max: number;
}

export interface Plot {
  readonly t0: number;
  readonly t1: number;
  readonly series: ReadonlyArray<PlottedSeries>;
}

const numeric = (value: number | boolean) => (typeof value === "boolean" ? (value ? 1 : 0) : value);
const round = (value: number) => Math.round(value * 100) / 100;

/** Every series shares the time axis; each gets its own value scale filling the box. */
export function plotSignals(series: ReadonlyArray<SystemsSignalSeries>, box: PlotBox): Plot {
  const times = series.flatMap((entry) => entry.points.map((point) => point.seconds));
  const t0 = times.length === 0 ? 0 : Math.min(...times);
  const last = times.length === 0 ? 1 : Math.max(...times);
  const t1 = last > t0 ? last : t0 + 1;
  const x = (seconds: number) => round(((seconds - t0) / (t1 - t0)) * box.width);
  return {
    t0,
    t1,
    series: series.map((entry) => {
      const values = entry.points.map((point) => numeric(point.value));
      const min = values.length === 0 ? 0 : Math.min(...values);
      const max = values.length === 0 ? 0 : Math.max(...values);
      // A constant signal sits mid-box instead of dividing by a zero range.
      const low = max > min ? min : min - 0.5;
      const high = max > min ? max : max + 0.5;
      const y = (value: number) => round(box.height - ((value - low) / (high - low)) * box.height);
      let path = "";
      entry.points.forEach((point, index) => {
        const value = values[index]!;
        path +=
          index === 0 ? `M${x(point.seconds)} ${y(value)}` : ` H${x(point.seconds)} V${y(value)}`;
      });
      if (entry.points.length > 0) path += ` H${box.width}`;
      return { signalId: entry.signalId, unit: entry.unit, path, min, max };
    }),
  };
}
