import { type StaticScreenProps } from "@react-navigation/native";
import { EnvironmentId, ProjectId, type SystemsRun } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import {
  formatTime,
  isActiveRun,
  runtimeLabel,
  statusTone,
} from "@t3tools/client-runtime/systems-presentation";
import { useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { uuidv4 } from "../../lib/uuid";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useEnvironmentQuery } from "../../state/query";
import { systemsEnvironment } from "../../state/systems";
import { useAtomCommand } from "../../state/use-atom-command";
import { SignalPlot } from "./SignalPlot";
import { failureText, SystemsBadge, SystemsDiagnostics } from "./SystemsDiagnostics";
import { TraceList } from "./TraceList";

type Props = StaticScreenProps<{
  readonly environmentId: string;
  readonly threadId: string;
  readonly projectId: string;
  readonly runId: string;
  /** The systems folder whose live run list carries this run; the project root when absent. */
  readonly path?: string;
}>;

export function SystemsRunRouteScreen({ route }: Props) {
  const environmentId = EnvironmentId.make(route.params.environmentId);
  const projectId = ProjectId.make(route.params.projectId);
  const { runId } = route.params;
  const live = useEnvironmentQuery(
    systemsEnvironment.runsLive({
      environmentId,
      input: { projectId, path: route.params.path ?? "" },
    }),
  );
  const fromLive = live.data?.runs.find((entry) => entry.runId === runId) ?? null;
  // Older runs fall outside the live list's newest 100; they are finished, so one read suffices.
  const fetched = useEnvironmentQuery(
    live.data && !fromLive
      ? systemsEnvironment.run({ environmentId, input: { projectId, runId } })
      : null,
  );
  const run = fromLive ?? fetched.data;
  const error = live.error ?? fetched.error;
  return (
    <View className="flex-1 bg-screen">
      <NativeStackScreenOptions options={{ title: run?.experimentId ?? "Run" }} />
      {run ? (
        <TraceList
          environmentId={environmentId}
          run={run}
          header={<RunSummary environmentId={environmentId} run={run} />}
        />
      ) : (
        <View className="p-4">
          <Text
            textRole="footnote"
            className={error ? "text-danger-foreground" : "text-foreground-muted"}
          >
            {error ?? "Loading run…"}
          </Text>
        </View>
      )}
    </View>
  );
}

function RunSummary(props: { readonly environmentId: EnvironmentId; readonly run: SystemsRun }) {
  const { environmentId, run } = props;
  const cancelRun = useAtomCommand(systemsEnvironment.cancelRun, { reportFailure: false });
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const terminal = !isActiveRun(run);

  const cancel = async () => {
    setError(null);
    setCancelling(true);
    const response = await cancelRun({
      environmentId,
      input: { projectId: run.projectId, runId: run.runId, idempotencyKey: uuidv4() },
    });
    setCancelling(false);
    if (response._tag === "Failure") setError(failureText(squashAtomCommandFailure(response)));
  };

  const rows = [
    ["Experiment", run.experimentRef],
    ["Solver · seed", `${run.solver} · ${run.seed}`],
    ["Runtime", runtimeLabel(run)],
    [
      "Progress",
      `t=${formatTime(run.lastCommittedTime)} of ${formatTime(run.stop)} s · ${run.boundaries} boundaries · ${run.eventCount} events · ${run.sampleCount} samples`,
    ],
  ] as const;
  const digests = [
    ["semantic", run.semanticDigest],
    ["plan", run.planDigest],
    ["run", run.runDigest],
    ["experiment", run.experimentDigest],
    ["inputs", run.inputDigest],
    ["capabilities", run.capabilityDigest],
  ] as const;

  return (
    <View className="gap-5 px-4 pt-4 pb-3">
      <View className="gap-2">
        <View className="flex-row items-center gap-2">
          <SystemsBadge label={run.status} tone={statusTone(run.status)} />
          <Text
            selectable
            textRole="caption"
            numberOfLines={1}
            className="min-w-0 flex-1 font-mono text-foreground-muted"
          >
            {run.runId}
          </Text>
        </View>
        {!terminal ? (
          <Button label="Cancel" tone="danger" loading={cancelling} onPress={() => void cancel()} />
        ) : null}
        {error ? (
          <Text selectable textRole="footnote" className="text-danger-foreground">
            {error}
          </Text>
        ) : null}
      </View>

      <View className="gap-2">
        {rows.map(([label, value]) => (
          <View key={label}>
            <Text textRole="caption" className="text-foreground-muted">
              {label}
            </Text>
            <Text selectable textRole="footnote">
              {value}
            </Text>
          </View>
        ))}
        {digests.map(([label, digest]) => (
          <View key={label}>
            <Text textRole="caption" className="text-foreground-muted">
              {label}
            </Text>
            <Text selectable textRole="caption" className="font-mono">
              {digest}
            </Text>
          </View>
        ))}
      </View>

      {run.hostDiagnostic ? (
        <Text selectable textRole="footnote" className="text-danger-foreground">
          {run.hostDiagnostic.code}: {run.hostDiagnostic.message}
        </Text>
      ) : null}
      {run.diagnostics.length > 0 ? (
        <SystemsDiagnostics diagnostics={run.diagnostics} empty="" />
      ) : null}
      <SignalPlot environmentId={environmentId} run={run} />
      {terminal ? <Comparison environmentId={environmentId} run={run} /> : null}
      <Text textRole="footnote" className="font-t3-medium text-foreground-muted">
        Trace
      </Text>
    </View>
  );
}

function Comparison(props: { readonly environmentId: EnvironmentId; readonly run: SystemsRun }) {
  const compare = useEnvironmentQuery(
    systemsEnvironment.compare({
      environmentId: props.environmentId,
      input: { projectId: props.run.projectId, runId: props.run.runId },
    }),
  );
  const result = compare.data;
  return (
    <View className="gap-2">
      <Text textRole="footnote" className="font-t3-medium text-foreground-muted">
        Expected trace
      </Text>
      {compare.error ? (
        <Text textRole="footnote" className="text-danger-foreground">
          {compare.error}
        </Text>
      ) : null}
      {result && result.expectedRef === null ? (
        <Text textRole="footnote" className="text-foreground-muted">
          No expected trace references this experiment.
        </Text>
      ) : null}
      {result && result.expectedRef !== null ? (
        <>
          <Text selectable textRole="footnote" className="font-mono">
            {result.expectedRef}
          </Text>
          {result.mismatches.length === 0 ? (
            <SystemsBadge label="matches" tone="success" />
          ) : (
            result.mismatches.map((mismatch) => (
              <View key={`${mismatch.kind}:${mismatch.message}`} className="gap-1">
                <SystemsBadge label={mismatch.kind} tone="error" />
                <Text selectable textRole="footnote">
                  {mismatch.message}
                </Text>
              </View>
            ))
          )}
        </>
      ) : null}
    </View>
  );
}
