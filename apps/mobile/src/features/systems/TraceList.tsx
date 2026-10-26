import { LegendList } from "@legendapp/list/react-native";
import type { EnvironmentId, SystemsRun, SystemsTraceEvent } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { formatTime, isActiveRun } from "@t3tools/client-runtime/systems-presentation";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { Platform, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/cn";
import { NativeScrollView } from "../../native/NativeScrollViewMarker";
import { systemsEnvironment } from "../../state/systems";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { failureText } from "./SystemsDiagnostics";
import {
  growingTraceCursor,
  nextTraceCursor,
  storeTracePage,
  TRACE_PAGE_SIZE,
  type TracePage,
} from "./tracePages";

const COLUMNS = [
  ["#", "w-12"],
  ["time", "w-16"],
  ["µstep", "w-11"],
  ["phase", "w-20"],
  ["kind", "flex-1"],
] as const;

const eventKey = (event: SystemsTraceEvent) => event.sequence;

/** The run's trace, 100 events a page, below `header`; the last unfilled page grows while live. */
export function TraceList(props: {
  readonly environmentId: EnvironmentId;
  readonly run: SystemsRun;
  readonly header: ReactElement;
}) {
  const { environmentId, run } = props;
  const fetchPage = useAtomQueryRunner(systemsEnvironment.events, {
    refresh: true,
    reportFailure: false,
  });
  const [pages, setPages] = useState<ReadonlyArray<TracePage<SystemsTraceEvent>>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(new Set<string>());

  const load = useCallback(
    (cursor: string) => {
      if (inFlight.current.has(cursor)) return;
      inFlight.current.add(cursor);
      setLoading(true);
      void fetchPage({
        environmentId,
        input: {
          projectId: run.projectId,
          runId: run.runId,
          fromSequence: cursor,
          limit: TRACE_PAGE_SIZE,
        },
      }).then((result) => {
        inFlight.current.delete(cursor);
        setLoading(inFlight.current.size > 0);
        if (result._tag === "Failure") {
          setError(failureText(squashAtomCommandFailure(result)));
          return;
        }
        setError(null);
        setPages((current) => storeTracePage(current, { cursor, ...result.value }));
      });
    },
    [environmentId, fetchPage, run.projectId, run.runId],
  );

  // Loads the first page, then refetches an unfilled last page whenever the run records events.
  const growing = growingTraceCursor(pages);
  useEffect(() => {
    if (growing !== null && run.eventCount > 0) load(growing);
  }, [growing, load, run.eventCount]);

  const next = nextTraceCursor(pages, isActiveRun(run));
  const events = pages.flatMap((page) => page.events);
  return (
    <LegendList
      renderScrollComponent={Platform.OS === "ios" ? NativeScrollView : undefined}
      className="flex-1"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingBottom: 32 }}
      data={events}
      estimatedItemSize={28}
      keyExtractor={eventKey}
      recycleItems
      ListHeaderComponent={
        <View>
          {props.header}
          <View className="flex-row gap-2 border-b border-border-subtle px-4 pb-1">
            {COLUMNS.map(([label, width]) => (
              <Text key={label} textRole="caption" className={cn(width, "text-foreground-muted")}>
                {label}
              </Text>
            ))}
          </View>
        </View>
      }
      renderItem={({ item }) => <TraceRow event={item} />}
      onEndReached={next !== null && !loading ? () => load(next) : undefined}
      onEndReachedThreshold={0.5}
      ListFooterComponent={
        <View className="gap-2 px-4 pt-3">
          {error ? (
            <Text selectable textRole="footnote" className="text-danger-foreground">
              {error}
            </Text>
          ) : null}
          {run.eventCount === 0 ? (
            <Text textRole="footnote" className="text-foreground-muted">
              No events yet.
            </Text>
          ) : null}
          {next !== null ? (
            <Button label="Load more" loading={loading} onPress={() => load(next)} />
          ) : null}
        </View>
      }
    />
  );
}

function TraceRow(props: { readonly event: SystemsTraceEvent }) {
  const { event } = props;
  return (
    <View className="flex-row gap-2 px-4 py-1">
      <Text textRole="caption" className="w-12 font-mono">
        {event.sequence}
      </Text>
      <Text textRole="caption" numberOfLines={1} className="w-16 font-mono">
        {formatTime(event.time)}
      </Text>
      <Text textRole="caption" className="w-11 font-mono">
        {event.microstep}
      </Text>
      <Text textRole="caption" numberOfLines={1} className="w-20">
        {event.phase}
      </Text>
      <Text textRole="caption" numberOfLines={1} className="min-w-0 flex-1">
        {event.kind}
        {event.entityId ? <Text className="text-foreground-muted"> · {event.entityId}</Text> : null}
      </Text>
    </View>
  );
}
