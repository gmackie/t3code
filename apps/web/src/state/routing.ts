/**
 * Routing state: what each environment's Pistache router reports.
 *
 * Every connected environment answers the same typed query. The page lists
 * environments whose router is configured; the composer badge asks one
 * environment about one thread.
 *
 * @module state/routing
 */
import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  RoutingOverview,
  RoutingThreadHistory,
  ThreadId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { environmentPresentations } from "./presentation";
import { serverEnvironment } from "./server";

export interface EnvironmentRoutingStatus {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly isPending: boolean;
  readonly error: string | null;
  readonly overview: RoutingOverview | null;
}

const routingOverviewsAtom = Atom.make((get): readonly EnvironmentRoutingStatus[] => {
  const presentations = get(environmentPresentations.presentationsAtom);
  const statuses: EnvironmentRoutingStatus[] = [];
  for (const [environmentId, presentation] of presentations) {
    const result = get(serverEnvironment.routingOverview({ environmentId, input: {} }));
    statuses.push({
      environmentId,
      label: presentation.entry.target.label,
      isPending: result.waiting,
      error: result._tag === "Failure" ? "This environment could not report routing." : null,
      overview: Option.getOrNull(AsyncResult.value(result)),
    });
  }
  return statuses;
}).pipe(Atom.withLabel("web-routing:overviews"));

export function useRoutingOverviews(): readonly EnvironmentRoutingStatus[] {
  return useAtomValue(routingOverviewsAtom);
}

export function useRoutingThreadHistory(
  environmentId: EnvironmentId,
  threadId: ThreadId,
): RoutingThreadHistory | null {
  const result = useAtomValue(
    serverEnvironment.routingThreadHistory({ environmentId, input: { threadId } }),
  );
  return Option.getOrNull(AsyncResult.value(result));
}
