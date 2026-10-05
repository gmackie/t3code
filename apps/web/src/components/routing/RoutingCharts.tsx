import { useState } from "react";

import { formatCount, formatHourShort } from "@t3tools/shared/usageFormat";
import { colorForLabel, type StackedSeries } from "./routingOverview.logic";

const VIEW_WIDTH = 960;
const VIEW_HEIGHT = 160;
const GAP = 2;

/**
 * Stacked bars, one per hour, for one rollup series. Each label keeps its
 * color across ranges because the caller fixes the label order.
 */
export function StackedHourChart({
  title,
  series,
  stacked,
  timeZone,
}: {
  readonly title: string;
  readonly series: string;
  readonly stacked: StackedSeries;
  readonly timeZone: string;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const count = stacked.columns.length;
  const slot = count === 0 ? 0 : VIEW_WIDTH / count;
  const barWidth = Math.max(1, slot - GAP);
  const toHeight = (value: number) =>
    stacked.peak === 0 ? 0 : (value / stacked.peak) * (VIEW_HEIGHT - 4);
  const hovered = hoverIndex === null ? undefined : stacked.columns[hoverIndex];
  const total = stacked.columns.reduce((sum, column) => sum + column.total, 0);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          {hovered
            ? `${formatHourShort(new Date(hovered.hour * 1000).toISOString(), timeZone)} · ${formatCount(hovered.total)}`
            : `${formatCount(total)} total`}
        </span>
      </div>
      <svg
        className="h-32 w-full"
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${title} per hour`}
        onMouseLeave={() => setHoverIndex(null)}
      >
        <line
          x1={0}
          x2={VIEW_WIDTH}
          y1={VIEW_HEIGHT}
          y2={VIEW_HEIGHT}
          stroke="currentColor"
          className="text-border"
          vectorEffect="non-scaling-stroke"
        />
        {stacked.columns.map((column, index) => {
          let y = VIEW_HEIGHT;
          return (
            <g key={column.hour} onMouseEnter={() => setHoverIndex(index)}>
              {/* Hit target wider than the bar so sparse hours are hoverable. */}
              <rect x={index * slot} y={0} width={slot} height={VIEW_HEIGHT} fill="transparent" />
              {column.values.map((value, labelIndex) => {
                if (value <= 0) return null;
                const height = toHeight(value);
                y -= height;
                return (
                  <rect
                    key={stacked.labels[labelIndex]}
                    x={index * slot + GAP / 2}
                    y={y}
                    width={barWidth}
                    height={Math.max(0, height - GAP)}
                    fill={colorForLabel(series, stacked.labels[labelIndex] ?? "", labelIndex)}
                    opacity={hoverIndex === null || hoverIndex === index ? 1 : 0.5}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {stacked.labels.map((label, index) => (
          <li key={label} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: colorForLabel(series, label, index) }}
            />
            <span>{series === "decisions.tier" ? `Tier ${label}` : label}</span>
            <span className="text-foreground tabular-nums">
              {formatCount(hovered ? (hovered.values[index] ?? 0) : sumLabel(stacked, index))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function sumLabel(stacked: StackedSeries, index: number): number {
  return stacked.columns.reduce((sum, column) => sum + (column.values[index] ?? 0), 0);
}

/** A single-hue proportion bar, for cache hit rate and window remaining. */
export function RatioBar({ value, label }: { readonly value: number; readonly label: string }) {
  const percent = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={label}
    >
      <div className="h-full rounded-full bg-info" style={{ width: `${percent}%` }} />
    </div>
  );
}
