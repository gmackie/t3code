import { useEffect, useState } from "react";
import type { EnvironmentId, SystemsRun } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { systemsEnvironment } from "~/state/systems";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { randomUUID } from "~/lib/utils";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import {
  formatTime,
  isActiveRun,
  plotSignals,
  runtimeLabel,
  statusTone,
} from "@t3tools/client-runtime/systems-presentation";
import { Diagnostics } from "./SystemsDiagnostics";

const PAGE_SIZE = 100;
const PLOT = { width: 640, height: 80 } as const;
const LINE_CLASSES = ["text-sky-500", "text-amber-500", "text-emerald-500", "text-fuchsia-500"];

/** Pages already loaded per run, so reopening a run keeps its cursors instead of restarting. */
const loadedCursors = new Map<string, ReadonlyArray<string>>();

export function SystemsRunDetail({
  environmentId,
  run,
}: {
  readonly environmentId: EnvironmentId;
  readonly run: SystemsRun;
}) {
  const ref = { projectId: run.projectId, runId: run.runId };
  const cancelRun = useAtomCommand(systemsEnvironment.cancelRun, { reportFailure: false });
  const [error, setError] = useState<string | null>(null);
  const terminal = !isActiveRun(run);

  async function cancel() {
    setError(null);
    const response = await cancelRun({
      environmentId,
      input: { ...ref, idempotencyKey: randomUUID() },
    });
    if (response._tag === "Failure") setError(String(squashAtomCommandFailure(response)));
  }

  const digests = [
    ["semantic", run.semanticDigest],
    ["plan", run.planDigest],
    ["run", run.runDigest],
    ["experiment", run.experimentDigest],
    ["inputs", run.inputDigest],
    ["capabilities", run.capabilityDigest],
  ] as const;

  return (
    <div className="space-y-4 border-t border-border p-3 text-xs">
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate font-semibold">
          {run.experimentId} <span className="font-mono text-muted-foreground">{run.runId}</span>
        </h3>
        <Badge variant={statusTone(run.status)}>{run.status}</Badge>
        {!terminal && (
          <Button size="xs" variant="destructive-outline" onClick={() => void cancel()}>
            Cancel
          </Button>
        )}
      </div>
      {error && <p className="text-destructive">{error}</p>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        <dt className="text-muted-foreground">Experiment</dt>
        <dd className="font-mono">{run.experimentRef}</dd>
        <dt className="text-muted-foreground">Solver · seed</dt>
        <dd>
          {run.solver} · {run.seed}
        </dd>
        <dt className="text-muted-foreground">Runtime</dt>
        <dd>{runtimeLabel(run)}</dd>
        <dt className="text-muted-foreground">Progress</dt>
        <dd>
          t={formatTime(run.lastCommittedTime)} of {formatTime(run.stop)} s · {run.boundaries}{" "}
          boundaries · {run.eventCount} events · {run.sampleCount} samples
        </dd>
        {digests.map(([label, digest]) => (
          <DigestRow key={label} label={label} digest={digest} />
        ))}
      </dl>
      {run.hostDiagnostic && (
        <p className="text-destructive">
          {run.hostDiagnostic.code}: {run.hostDiagnostic.message}
        </p>
      )}
      {run.diagnostics.length > 0 && <Diagnostics diagnostics={run.diagnostics} empty="" />}
      <SignalPlot environmentId={environmentId} run={run} />
      {terminal && <Comparison environmentId={environmentId} run={run} />}
      <TraceTable environmentId={environmentId} run={run} />
    </div>
  );
}

function DigestRow({ label, digest }: { readonly label: string; readonly digest: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-all font-mono">{digest}</dd>
    </>
  );
}

function SignalPlot({
  environmentId,
  run,
}: {
  readonly environmentId: EnvironmentId;
  readonly run: SystemsRun;
}) {
  const [chosen, setChosen] = useState<ReadonlyArray<string>>(() =>
    run.probes.slice(0, 2).map((probe) => probe.id),
  );
  const signals = useEnvironmentQuery(
    chosen.length > 0 && run.sampleCount > 0
      ? systemsEnvironment.signals({
          environmentId,
          input: {
            projectId: run.projectId,
            runId: run.runId,
            signalIds: chosen,
            maxPoints: PLOT.width,
          },
        })
      : null,
  );
  // Live runs push progress; refetch the bounded, downsampled view when new samples land.
  const refresh = signals.refresh;
  useEffect(() => {
    if (run.sampleCount > 0) refresh();
  }, [run.sampleCount, refresh]);
  const plot = signals.data ? plotSignals(signals.data.series, PLOT) : null;
  if (run.probes.length === 0) return null;
  return (
    <div>
      <h4 className="font-semibold">Signals</h4>
      <div className="mt-1 flex flex-wrap gap-1">
        {run.probes.map((probe) => {
          const on = chosen.includes(probe.id);
          return (
            <Button
              key={probe.id}
              size="xs"
              variant={on ? "secondary" : "ghost"}
              aria-pressed={on}
              onClick={() =>
                setChosen(on ? chosen.filter((id) => id !== probe.id) : [...chosen, probe.id])
              }
            >
              {probe.id} ({probe.unit})
            </Button>
          );
        })}
      </div>
      {signals.error && <p className="text-destructive">{signals.error}</p>}
      {plot?.series.map((series, index) => (
        <figure key={series.signalId} className="mt-2">
          <figcaption className="text-muted-foreground">
            {series.signalId} [{series.unit}] min {series.min} · max {series.max} · t {plot.t0}–
            {plot.t1} s
          </figcaption>
          <svg
            role="img"
            aria-label={`${series.signalId} over time`}
            viewBox={`-1 -1 ${PLOT.width + 2} ${PLOT.height + 2}`}
            preserveAspectRatio="none"
            className={`h-20 w-full ${LINE_CLASSES[index % LINE_CLASSES.length]}`}
          >
            <path
              d={series.path}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </figure>
      ))}
    </div>
  );
}

function Comparison({
  environmentId,
  run,
}: {
  readonly environmentId: EnvironmentId;
  readonly run: SystemsRun;
}) {
  const compare = useEnvironmentQuery(
    systemsEnvironment.compare({
      environmentId,
      input: { projectId: run.projectId, runId: run.runId },
    }),
  );
  const result = compare.data;
  return (
    <div>
      <h4 className="font-semibold">Expected trace</h4>
      {compare.error && <p className="text-destructive">{compare.error}</p>}
      {result && result.expectedRef === null && (
        <p className="text-muted-foreground">No expected trace references this experiment.</p>
      )}
      {result && result.expectedRef !== null && (
        <>
          <p className="font-mono">{result.expectedRef}</p>
          {result.mismatches.length === 0 ? (
            <p>
              <Badge variant="success">matches</Badge>
            </p>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {result.mismatches.map((mismatch) => (
                <li key={`${mismatch.kind}:${mismatch.message}`}>
                  <Badge variant="error">{mismatch.kind}</Badge> {mismatch.message}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function TraceTable({
  environmentId,
  run,
}: {
  readonly environmentId: EnvironmentId;
  readonly run: SystemsRun;
}) {
  const [cursors, setCursors] = useState<ReadonlyArray<string>>(
    () => loadedCursors.get(run.runId) ?? ["0"],
  );
  const more = (next: string) => {
    const updated = [...cursors, next];
    loadedCursors.set(run.runId, updated);
    setCursors(updated);
  };
  return (
    <div>
      <h4 className="font-semibold">Trace</h4>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>#</TableHead>
            <TableHead>time</TableHead>
            <TableHead>µstep</TableHead>
            <TableHead>phase</TableHead>
            <TableHead>kind</TableHead>
            <TableHead>entity</TableHead>
          </TableRow>
        </TableHeader>
        {cursors.map((cursor, index) => (
          <TracePage
            key={cursor}
            environmentId={environmentId}
            run={run}
            fromSequence={cursor}
            last={index === cursors.length - 1}
            onMore={more}
          />
        ))}
      </Table>
    </div>
  );
}

function TracePage({
  environmentId,
  run,
  fromSequence,
  last,
  onMore,
}: {
  readonly environmentId: EnvironmentId;
  readonly run: SystemsRun;
  readonly fromSequence: string;
  readonly last: boolean;
  readonly onMore: (next: string) => void;
}) {
  const page = useEnvironmentQuery(
    systemsEnvironment.events({
      environmentId,
      input: { projectId: run.projectId, runId: run.runId, fromSequence, limit: PAGE_SIZE },
    }),
  );
  // Only an unfilled last page can grow while the run is live.
  const refresh = page.refresh;
  const filled = (page.data?.events.length ?? 0) >= PAGE_SIZE;
  useEffect(() => {
    if (last && !filled && run.eventCount > 0) refresh();
  }, [last, filled, run.eventCount, refresh]);
  return (
    <TableBody>
      {page.error && (
        <TableRow>
          <TableCell colSpan={6}>{page.error}</TableCell>
        </TableRow>
      )}
      {page.data?.events.map((event) => (
        <TableRow key={event.sequence}>
          <TableCell>{event.sequence}</TableCell>
          <TableCell>{formatTime(event.time)}</TableCell>
          <TableCell>{event.microstep}</TableCell>
          <TableCell>{event.phase}</TableCell>
          <TableCell>{event.kind}</TableCell>
          <TableCell>{event.entityId ?? ""}</TableCell>
        </TableRow>
      ))}
      {last && filled && (page.data?.hasMore || isActiveRun(run)) && (
        <TableRow>
          <TableCell colSpan={6}>
            <Button size="xs" variant="outline" onClick={() => onMore(page.data!.nextSequence)}>
              Load more
            </Button>
          </TableCell>
        </TableRow>
      )}
    </TableBody>
  );
}
