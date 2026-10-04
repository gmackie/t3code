import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import {
  formatCount,
  formatDateTimeShort,
  formatPercent,
  formatTokens,
} from "@t3tools/shared/usageFormat";
import { isElectron } from "../../env";
import { useEscapeToGoBack } from "../../hooks/useNavigateBack";
import { useRoutingOverviews, type EnvironmentRoutingStatus } from "../../state/routing";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { Skeleton } from "../ui/skeleton";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { RatioBar, StackedHourChart } from "./RoutingCharts";
import {
  RANGE_OPTIONS,
  cacheHitRates,
  downgradeStats,
  formatHoursToReset,
  hoursInRange,
  rowsInRange,
  stackByHour,
  totalsBySeries,
  windowViews,
  type RoutingRange,
} from "./routingOverview.logic";

const FUNNEL_STAGES = [
  { series: "decisions.source", title: "Decisions by source" },
  { series: "decisions.tier", title: "Decisions by tier" },
  { series: "decisions.model", title: "Decisions by model" },
] as const;

export function RoutingPage() {
  useEscapeToGoBack();
  const [range, setRange] = useState<RoutingRange>("24h");
  const environments = useRoutingOverviews();
  const configured = environments.filter(
    (environment) => environment.overview?.configured || environment.error !== null,
  );
  const pending = environments.some(
    (environment) => environment.isPending && environment.overview === null,
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron} className="h-auto">
          <div className="flex w-full min-w-0 items-center justify-between gap-3 py-2">
            <WorkspaceBreadcrumb ariaLabel="Routing breadcrumb" className="min-w-0">
              <WorkspaceBreadcrumbItem current>
                <h1>Routing</h1>
              </WorkspaceBreadcrumbItem>
            </WorkspaceBreadcrumb>
            <ToggleGroup
              aria-label="Routing range"
              variant="segmented"
              value={[range]}
              onValueChange={(next) => {
                const value = next[0];
                if (value === "24h" || value === "7d") setRange(value);
              }}
            >
              {RANGE_OPTIONS.map((option) => (
                <Toggle key={option.value} value={option.value}>
                  {option.label}
                </Toggle>
              ))}
            </ToggleGroup>
          </div>
        </WorkspacePageHeader>

        <ScrollArea className="min-h-0 flex-1">
          <WorkspacePageContainer width="wide">
            {configured.length === 0 ? (
              pending ? (
                <RoutingSkeleton />
              ) : (
                <RoutingUnconfigured hasEnvironments={environments.length > 0} />
              )
            ) : (
              configured.map((environment) => (
                <EnvironmentRouting
                  key={environment.environmentId}
                  environment={environment}
                  range={range}
                  showLabel={environments.length > 1}
                />
              ))
            )}
          </WorkspacePageContainer>
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}

function RoutingUnconfigured({ hasEnvironments }: { readonly hasEnvironments: boolean }) {
  return (
    <div className="flex max-w-prose flex-col gap-3 text-sm text-muted-foreground">
      <h2 className="text-base font-medium text-foreground">No router configured</h2>
      {hasEnvironments ? (
        <>
          <p>
            Routing shows what a Pistache router decided for the requests your OpenCode threads send
            through it. To connect one, add an OpenCode provider instance with the id{" "}
            <code>pistache</code> in{" "}
            <Link to="/settings/providers" className="text-foreground underline">
              Settings → Providers
            </Link>{" "}
            and set two environment variables on it: <code>PISTACHE_API_KEY</code> (mark it
            sensitive) and either <code>PISTACHE_BASE_URL</code> or an{" "}
            <code>OPENCODE_CONFIG_CONTENT</code> whose <code>pistache</code> provider has a{" "}
            <code>baseURL</code>.
          </p>
          <p>The page fills in on the next provider refresh after you save.</p>
        </>
      ) : (
        <p>Connect an environment to see routing.</p>
      )}
    </div>
  );
}

function EnvironmentRouting({
  environment,
  range,
  showLabel,
}: {
  readonly environment: EnvironmentRoutingStatus;
  readonly range: RoutingRange;
  readonly showLabel: boolean;
}) {
  const overview = environment.overview;
  const timeZone = useMemo(() => new Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  // "Now" is the server's fetch time, so the hour grid only moves when fresh data arrives.
  const [mountedAt] = useState(() => Date.now());
  const now = overview?.fetchedAt ? Date.parse(overview.fetchedAt) : mountedAt;
  const hours = useMemo(() => hoursInRange(Math.floor(now / 1000), range), [now, range]);
  const rows = useMemo(() => rowsInRange(overview?.rows ?? [], hours), [overview, hours]);
  // Label order comes from the whole window so a label's color survives range switches.
  const stacks = useMemo(
    () =>
      FUNNEL_STAGES.map((stage) => ({
        ...stage,
        stacked: stackByHour(
          rows,
          stage.series,
          hours,
          totalsBySeries(overview?.rows ?? [], stage.series).map((entry) => entry.label),
        ),
      })),
    [hours, overview, rows],
  );
  const downgrades = useMemo(() => downgradeStats(rows), [rows]);
  const cache = useMemo(() => cacheHitRates(rows), [rows]);
  const windows = useMemo(() => windowViews(overview?.windows ?? [], now), [overview, now]);
  const decisions = stacks[0]?.stacked.columns.reduce((sum, column) => sum + column.total, 0) ?? 0;

  return (
    <div className="flex flex-col gap-8">
      {showLabel ? (
        <h2 className="text-base font-medium text-foreground">{environment.label}</h2>
      ) : null}
      {environment.error !== null || overview?.error ? (
        <Alert variant="error">
          <AlertTitle>Router unreachable</AlertTitle>
          <AlertDescription>
            {environment.error ?? overview?.error}
            {overview?.fetchedAt
              ? ` Showing data from ${formatDateTimeShort(overview.fetchedAt, timeZone)}.`
              : ""}
          </AlertDescription>
        </Alert>
      ) : null}
      {overview && overview.alerts.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-foreground">Alerts</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {overview.alerts.slice(0, 10).map((alert) => (
              <li key={`${alert.at}:${alert.title}`} className="flex justify-between gap-3">
                <span className="min-w-0 truncate text-foreground">{alert.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {formatDateTimeShort(alert.at, timeZone)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
        <Metric label="Decisions" value={formatCount(decisions)} />
        <Metric
          label="Downgrades"
          value={formatCount(downgrades.downgrades)}
          detail={decisions === 0 ? undefined : formatPercent(downgrades.downgrades / decisions)}
        />
        <Metric
          label="Downgrade failures"
          value={downgrades.failureRate === null ? "—" : formatPercent(downgrades.failureRate)}
          detail={`${formatCount(downgrades.failed)} of ${formatCount(downgrades.failed + downgrades.completed)} settled`}
        />
        <Metric
          label="Windows"
          value={formatCount(windows.length)}
          detail={
            windows[0]
              ? `lowest ${windows[0].remainingPercent}% ${windows[0].window.label}`
              : undefined
          }
        />
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-sm font-medium text-foreground">Funnel</h2>
        {stacks.map((stage) => (
          <StackedHourChart
            key={stage.series}
            title={stage.title}
            series={stage.series}
            stacked={stage.stacked}
            timeZone={timeZone}
          />
        ))}
      </section>

      <section className="grid gap-8 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-foreground">Cache hit rate</h2>
          {cache.length === 0 ? (
            <p className="text-sm text-muted-foreground">No outcomes in this range.</p>
          ) : (
            cache.map((entry) => (
              <div key={entry.model} className="flex flex-col gap-1">
                <div className="flex justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-foreground">{entry.model}</span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {entry.rate === null ? "—" : formatPercent(entry.rate)} ·{" "}
                    {formatTokens(entry.cachedTokens)}/{formatTokens(entry.inputTokens)}
                  </span>
                </div>
                <RatioBar value={entry.rate ?? 0} label={`${entry.model} cache hit rate`} />
              </div>
            ))
          )}
        </div>
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-foreground">Subscription windows</h2>
          {windows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              The router has not observed any windows.
            </p>
          ) : (
            windows.map((view) => (
              <div key={view.window.id} className="flex flex-col gap-1">
                <div className="flex justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-foreground">
                    {view.window.label}{" "}
                    <span className="text-muted-foreground">
                      {view.window.provider} · {view.window.account}
                    </span>
                  </span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {view.remainingPercent}% left · {formatHoursToReset(view.hoursToReset)}
                  </span>
                </div>
                <RatioBar
                  value={view.window.remainingFraction}
                  label={`${view.window.label} remaining`}
                />
              </div>
            ))
          )}
        </div>
      </section>

      {overview && overview.usage.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-foreground">Operator counters</h2>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
            {overview.usage.map((counter) => (
              <Metric
                key={counter.id}
                label={counter.label}
                value={formatCount(counter.used)}
                detail={
                  counter.threshold === null
                    ? undefined
                    : `alerts at ${formatCount(counter.threshold)}`
                }
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Metric({
  label,
  value,
  detail,
}: {
  readonly label: string;
  readonly value: string;
  readonly detail?: string | undefined;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-base font-medium text-foreground tabular-nums">{value}</span>
      {detail ? <span className="text-xs text-muted-foreground">{detail}</span> : null}
    </div>
  );
}

function RoutingSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </div>
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}
