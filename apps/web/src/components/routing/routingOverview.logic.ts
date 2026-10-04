import type { RoutingMetricRow, RoutingWindow } from "@t3tools/contracts";

export type RoutingRange = "24h" | "7d";

export const RANGE_OPTIONS: ReadonlyArray<{
  readonly value: RoutingRange;
  readonly label: string;
}> = [
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
];

const HOUR = 3600;
const RANGE_HOURS: Record<RoutingRange, number> = { "24h": 24, "7d": 7 * 24 };

/** Hour starts (epoch seconds) covering the range and ending at the current hour. */
export function hoursInRange(nowEpochSeconds: number, range: RoutingRange): readonly number[] {
  const end = Math.floor(nowEpochSeconds / HOUR) * HOUR;
  const count = RANGE_HOURS[range];
  return Array.from({ length: count }, (_, index) => end - (count - 1 - index) * HOUR);
}

export function rowsInRange(
  rows: readonly RoutingMetricRow[],
  hours: readonly number[],
): readonly RoutingMetricRow[] {
  const first = hours[0];
  const last = hours[hours.length - 1];
  if (first === undefined || last === undefined) return [];
  return rows.filter((row) => row.hour >= first && row.hour <= last);
}

/** Totals by label for one series, largest first. */
export function totalsBySeries(
  rows: readonly RoutingMetricRow[],
  series: string,
): ReadonlyArray<{ readonly label: string; readonly value: number }> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.series !== series) continue;
    totals.set(row.label, (totals.get(row.label) ?? 0) + row.value);
  }
  return [...totals]
    .map(([label, value]) => ({ label, value }))
    .toSorted((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

export interface StackedColumn {
  readonly hour: number;
  /** Values keyed by label, in the legend's label order. */
  readonly values: ReadonlyArray<number>;
  readonly total: number;
}

export interface StackedSeries {
  readonly labels: readonly string[];
  readonly columns: readonly StackedColumn[];
  readonly peak: number;
}

/**
 * Pivots one series into a stacked column per hour. Labels keep the order of
 * their totals so the legend reads largest first and a label's color is
 * stable while the range changes.
 */
export function stackByHour(
  rows: readonly RoutingMetricRow[],
  series: string,
  hours: readonly number[],
  labelOrder: readonly string[] = totalsBySeries(rows, series).map((entry) => entry.label),
): StackedSeries {
  const byHour = new Map<number, Map<string, number>>();
  for (const row of rows) {
    if (row.series !== series) continue;
    const cell = byHour.get(row.hour) ?? new Map<string, number>();
    cell.set(row.label, (cell.get(row.label) ?? 0) + row.value);
    byHour.set(row.hour, cell);
  }
  const columns = hours.map((hour) => {
    const cell = byHour.get(hour);
    const values = labelOrder.map((label) => cell?.get(label) ?? 0);
    return { hour, values, total: values.reduce((sum, value) => sum + value, 0) };
  });
  return {
    labels: labelOrder,
    columns,
    peak: columns.reduce((max, column) => Math.max(max, column.total), 0),
  };
}

export interface DowngradeStats {
  readonly downgrades: number;
  readonly completed: number;
  readonly failed: number;
  /** Failed share of downgrades with a recorded outcome; null until one exists. */
  readonly failureRate: number | null;
}

export function downgradeStats(rows: readonly RoutingMetricRow[]): DowngradeStats {
  const downgrades = totalsBySeries(rows, "decisions.downgrade").reduce(
    (sum, entry) => sum + entry.value,
    0,
  );
  const outcomes = totalsBySeries(rows, "downgrade.outcome");
  const completed = outcomes.find((entry) => entry.label === "completed")?.value ?? 0;
  const failed = outcomes
    .filter((entry) => entry.label !== "completed")
    .reduce((sum, entry) => sum + entry.value, 0);
  const settled = completed + failed;
  return { downgrades, completed, failed, failureRate: settled === 0 ? null : failed / settled };
}

export interface CacheHitRate {
  readonly model: string;
  readonly inputTokens: number;
  readonly cachedTokens: number;
  /** cached / input; null when the model saw no input in the range. */
  readonly rate: number | null;
}

/** Per model, most input first. */
export function cacheHitRates(rows: readonly RoutingMetricRow[]): readonly CacheHitRate[] {
  const input = new Map(totalsBySeries(rows, "tokens.input").map((e) => [e.label, e.value]));
  const cached = new Map(totalsBySeries(rows, "tokens.cached").map((e) => [e.label, e.value]));
  return [...new Set([...input.keys(), ...cached.keys()])]
    .map((model) => {
      const inputTokens = input.get(model) ?? 0;
      const cachedTokens = cached.get(model) ?? 0;
      return {
        model,
        inputTokens,
        cachedTokens,
        rate: inputTokens === 0 ? null : Math.min(1, cachedTokens / inputTokens),
      };
    })
    .toSorted((a, b) => b.inputTokens - a.inputTokens || a.model.localeCompare(b.model));
}

export interface WindowView {
  readonly window: RoutingWindow;
  readonly remainingPercent: number;
  /** Negative once the window has already reset and no newer observation arrived. */
  readonly hoursToReset: number;
}

export function windowViews(
  windows: readonly RoutingWindow[],
  nowEpochMillis: number,
): readonly WindowView[] {
  return windows
    .map((window) => ({
      window,
      remainingPercent: Math.round(window.remainingFraction * 100),
      hoursToReset: (Date.parse(window.resetsAt) - nowEpochMillis) / (HOUR * 1000),
    }))
    .toSorted((a, b) => a.remainingPercent - b.remainingPercent);
}

export function formatHoursToReset(hours: number): string {
  if (hours <= 0) return "resetting";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min to reset`;
  if (hours < 48) return `${Math.round(hours)} h to reset`;
  return `${Math.round(hours / 24)} d to reset`;
}

/** Validated categorical slots; identity colors assigned in label order, never cycled. */
export const CATEGORICAL_COLORS: readonly string[] = [
  "#2a78d6",
  "#eb6834",
  "#1baf7a",
  "#eda100",
  "#e87ba4",
  "#008300",
  "#4a3aa7",
  "#e34948",
];

/** Tiers are ordinal: one hue, darker as the tier gets stronger. */
export const TIER_COLORS: Readonly<Record<string, string>> = {
  "1": "#86b6ef",
  "2": "#3987e5",
  "3": "#1c5cab",
};

export function colorForLabel(series: string, label: string, index: number): string {
  if (series === "decisions.tier") return TIER_COLORS[label] ?? CATEGORICAL_COLORS[0]!;
  // Past the eighth label everything is "Other" grey rather than a new hue.
  return CATEGORICAL_COLORS[index] ?? "#8a8a85";
}
