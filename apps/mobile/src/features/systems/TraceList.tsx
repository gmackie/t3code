import { LegendList } from "@legendapp/list/react-native";
import type { EnvironmentId, SystemsRun, SystemsTraceEvent } from "@t3tools/contracts";
import { formatTime, isActiveRun } from "@t3tools/client-runtime/systems-presentation";
import { useMemo, useState, type ReactElement } from "react";
import { useAtomValue } from "@effect/atom-react";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom } from "effect/reactivity";
import { Platform, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { cn } from "../../lib/cn";
import { NativeScrollView } from "../../native/NativeScrollViewMarker";
import { systemsEnvironment } from "../../state/systems";
import { failureText } from "./SystemsDiagnostics";
import { nextTraceCursor, TRACE_PAGE_SIZE } from "./tracePages";

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
  const [cursors, setCursors] = useState<ReadonlyArray<string>>(["0"]);
  const { projectId, runId } = run;
  const results = useAtomValue(
    useMemo(
      () =>
        Atom.make((get) =>
          cursors.map((cursor) => ({
            cursor,
            result: get(
              systemsEnvironment.events({
                environmentId,
                input: { projectId, runId, fromSequence: cursor, limit: TRACE_PAGE_SIZE },
              }),
            ),
          })),
        ),
      [cursors, environmentId, projectId, runId],
    ),
  );
  const pages = results.flatMap(({ cursor, result }) => {
    const page = AsyncResult.getOrElse(result, () => null);
    return page === null ? [] : [{ cursor, ...page }];
  });
  const loading = results.some(({ result }) => result.waiting);
  const failed = results.find(({ result }) => result._tag === "Failure")?.result;
  const error = failed?._tag === "Failure" ? failureText(Cause.squash(failed.cause)) : null;
  const load = (cursor: string) =>
    setCursors((previous) => (previous.includes(cursor) ? previous : [...previous, cursor]));

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
