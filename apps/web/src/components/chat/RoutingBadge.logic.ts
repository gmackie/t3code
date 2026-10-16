import type { ProviderInstanceId, RoutingDecision, RoutingThreadHistory } from "@t3tools/contracts";

/** The badge is only meaningful for threads that run through the router. */
export const PISTACHE_INSTANCE_ID = "pistache";

export function shouldShowRoutingBadge(
  instanceId: ProviderInstanceId | string | null | undefined,
): boolean {
  return instanceId === PISTACHE_INSTANCE_ID;
}

/** Newest decision, or null when the router has none or is not configured. */
export function latestRoutingDecision(
  history: RoutingThreadHistory | null | undefined,
): RoutingDecision | null {
  if (!history?.configured) return null;
  return history.decisions[0] ?? null;
}

/** "Routed to Sol (tier 2) · extraction 0.92" */
export function formatRoutingDecision(decision: RoutingDecision): string {
  return `Routed to ${decision.label} (tier ${decision.tier}) · ${decision.kind} ${decision.confidence.toFixed(2)}`;
}

/** Short trigger text: the model label plus the tier. */
export function formatRoutingBadgeLabel(decision: RoutingDecision): string {
  return `${decision.label} · T${decision.tier}`;
}

export function formatRoutingAdvice(advice: RoutingDecision["advice"]): string | null {
  switch (advice) {
    case "compact":
      return "The router advises compacting this thread before the next turn.";
    case "handoff":
      return "The router is switching models; the cached prefix will go cold.";
    case null:
      return null;
  }
}

export function formatRoutingSource(decision: RoutingDecision): string {
  const turn = decision.turn === "continuation" ? "continuation" : "user turn";
  return `${decision.source} · ${turn}`;
}

/**
 * The decisions that produced one assistant message: those made at or after
 * `start` (the message's turn boundary, see `computeMessageDurationStart`) and
 * no later than `end` (when the message finished; null while it streams).
 * Oldest first.
 */
export function servedDecisions(
  history: RoutingThreadHistory | null | undefined,
  start: string,
  end: string | null,
): ReadonlyArray<RoutingDecision> {
  if (!history?.configured) return [];
  const from = Date.parse(start);
  const to = end === null ? Number.POSITIVE_INFINITY : Date.parse(end);
  return history.decisions
    .filter((decision) => {
      const at = Date.parse(decision.at);
      return at >= from && at <= to;
    })
    .toSorted((a, b) => a.at.localeCompare(b.at));
}

/** "Sonnet · T2", or "Haiku → Sonnet · T1–2" when the turn changed models. */
export function formatServedModels(decisions: ReadonlyArray<RoutingDecision>): string | null {
  if (decisions.length === 0) return null;
  const labels: string[] = [];
  for (const decision of decisions) {
    if (labels.at(-1) !== decision.label) labels.push(decision.label);
  }
  const tiers = decisions.map((decision) => decision.tier);
  const low = Math.min(...tiers);
  const high = Math.max(...tiers);
  return `${labels.join(" → ")} · T${low === high ? low : `${low}–${high}`}`;
}
