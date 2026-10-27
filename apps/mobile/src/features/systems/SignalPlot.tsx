import type { EnvironmentId, SystemsRun } from "@t3tools/contracts";
import { plotSignals } from "@t3tools/client-runtime/systems-presentation";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { Path, Svg } from "react-native-svg";

import { AppText as Text } from "../../components/ui/AppText";
import { Chip } from "../../components/ui/Chip";
import { useEnvironmentQuery } from "../../state/query";
import { systemsEnvironment } from "../../state/systems";

const PLOT_HEIGHT = 80;
const MAX_POINTS = 640;
const LINE_COLORS = ["#0ea5e9", "#f59e0b", "#10b981", "#d946ef"] as const;

/** Static step plots of the chosen probes, refetched only when the run records new samples. */
export function SignalPlot(props: {
  readonly environmentId: EnvironmentId;
  readonly run: SystemsRun;
}) {
  const { run } = props;
  const [chosen, setChosen] = useState<ReadonlyArray<string>>(() =>
    run.probes.slice(0, 2).map((probe) => probe.id),
  );
  const [width, setWidth] = useState(0);
  const signals = useEnvironmentQuery(
    chosen.length > 0 && run.sampleCount > 0 && width > 0
      ? systemsEnvironment.signals({
          environmentId: props.environmentId,
          input: {
            projectId: run.projectId,
            runId: run.runId,
            signalIds: chosen,
            maxPoints: Math.max(2, Math.min(MAX_POINTS, width)),
          },
        })
      : null,
  );
  const refresh = signals.refresh;
  useEffect(() => {
    if (run.sampleCount > 0) refresh();
  }, [run.sampleCount, refresh]);
  const plot =
    signals.data && width > 0
      ? plotSignals(signals.data.series, { width, height: PLOT_HEIGHT })
      : null;
  if (run.probes.length === 0) return null;
  return (
    <View
      className="gap-2"
      onLayout={(event) => setWidth(Math.floor(event.nativeEvent.layout.width))}
    >
      <Text textRole="footnote" className="font-t3-medium text-foreground-muted">
        Signals
      </Text>
      <View className="flex-row flex-wrap gap-1.5">
        {run.probes.map((probe) => {
          const on = chosen.includes(probe.id);
          return (
            <Chip
              key={probe.id}
              size="small"
              label={`${probe.id} (${probe.unit})`}
              selected={on}
              accessibilityLabel={`${on ? "Hide" : "Plot"} ${probe.id}`}
              onPress={() =>
                setChosen(on ? chosen.filter((id) => id !== probe.id) : [...chosen, probe.id])
              }
            />
          );
        })}
      </View>
      {signals.error ? (
        <Text textRole="footnote" className="text-danger-foreground">
          {signals.error}
        </Text>
      ) : null}
      {plot?.series.map((series, index) => (
        <View key={series.signalId} className="gap-1">
          <Text textRole="caption" className="text-foreground-muted">
            {series.signalId} [{series.unit}] min {series.min} · max {series.max} · t {plot.t0}–
            {plot.t1} s
          </Text>
          <Svg
            accessibilityLabel={`${series.signalId} over time`}
            width={width}
            height={PLOT_HEIGHT + 2}
            viewBox={`-1 -1 ${width + 2} ${PLOT_HEIGHT + 2}`}
          >
            <Path
              d={series.path}
              fill="none"
              stroke={LINE_COLORS[index % LINE_COLORS.length]}
              strokeWidth={1.5}
            />
          </Svg>
        </View>
      ))}
    </View>
  );
}
