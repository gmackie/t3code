import type {
  EnvironmentId,
  ExternalThreadImportCandidate,
  ExternalThreadImportOutcome,
  ExternalThreadImportProviderDiscoveryResult,
  ExternalThreadImportCandidateToken,
  ThreadId,
} from "@t3tools/contracts";

export interface ExternalThreadImportRow {
  readonly candidate: ExternalThreadImportCandidate;
  readonly outcome?: ExternalThreadImportOutcome;
}

const searchableCandidateText = (candidate: ExternalThreadImportCandidate): string =>
  [
    candidate.provider.driver,
    candidate.provider.instanceId,
    candidate.title,
    candidate.firstPromptPreview,
    candidate.originalCwd,
    candidate.nativeThreadId,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLocaleLowerCase();

export function filterImportGroups(
  groups: ReadonlyArray<ExternalThreadImportProviderDiscoveryResult>,
  query: string,
): ExternalThreadImportProviderDiscoveryResult[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [...groups];
  const filtered: ExternalThreadImportProviderDiscoveryResult[] = [];
  for (const group of groups) {
    if (group._tag === "Failure") {
      const providerText =
        `${group.provider.driver} ${group.provider.instanceId}`.toLocaleLowerCase();
      if (providerText.includes(normalizedQuery)) filtered.push(group);
      continue;
    }
    const candidates = group.candidates.filter((candidate) =>
      searchableCandidateText(candidate).includes(normalizedQuery),
    );
    if (candidates.length > 0) filtered.push({ ...group, candidates });
  }
  return filtered;
}

export function selectedAvailableTokens(
  selected: ReadonlySet<string>,
  candidates: ReadonlyArray<ExternalThreadImportCandidate>,
): ExternalThreadImportCandidateToken[] {
  return candidates.flatMap((candidate) =>
    selected.has(candidate.token) && candidate.status._tag === "Available" ? [candidate.token] : [],
  );
}

export function setAvailableCandidateSelection(
  selected: ReadonlySet<string>,
  candidates: ReadonlyArray<ExternalThreadImportCandidate>,
  checked: boolean,
): Set<string> {
  const next = new Set(selected);
  for (const candidate of candidates) {
    if (candidate.status._tag !== "Available") continue;
    if (checked) next.add(candidate.token);
    else next.delete(candidate.token);
  }
  return next;
}

export function mergeImportGroups(
  current: ReadonlyArray<ExternalThreadImportProviderDiscoveryResult>,
  incoming: ReadonlyArray<ExternalThreadImportProviderDiscoveryResult>,
): ExternalThreadImportProviderDiscoveryResult[] {
  return mergeImportPage(current, incoming, new Set()).groups;
}

const providerKey = (provider: ExternalThreadImportCandidate["provider"]): string =>
  `${provider.driver}:${provider.instanceId}`;

const candidateKey = (candidate: ExternalThreadImportCandidate): string =>
  `${providerKey(candidate.provider)}:${candidate.nativeThreadId}`;

export function mergeImportPage(
  current: ReadonlyArray<ExternalThreadImportProviderDiscoveryResult>,
  incoming: ReadonlyArray<ExternalThreadImportProviderDiscoveryResult>,
  selected: ReadonlySet<string>,
): {
  readonly groups: ExternalThreadImportProviderDiscoveryResult[];
  readonly selected: Set<string>;
} {
  let groups = [...current];
  const nextSelected = new Set(selected);
  for (const next of incoming) {
    const key = providerKey(next.provider);
    const sameProvider = groups.filter((group) => providerKey(group.provider) === key);
    if (next._tag === "Failure") {
      groups = groups.filter(
        (group) => providerKey(group.provider) !== key || group._tag !== "Failure",
      );
      groups.push(next);
      continue;
    }

    const existingCandidates = sameProvider.flatMap((group) =>
      group._tag === "Success" ? group.candidates : [],
    );
    const selectedIdentities = new Set(
      existingCandidates.filter((candidate) => selected.has(candidate.token)).map(candidateKey),
    );
    const byIdentity = new Map(
      existingCandidates.map((candidate) => [candidateKey(candidate), candidate]),
    );
    for (const candidate of next.candidates) byIdentity.set(candidateKey(candidate), candidate);
    for (const candidate of byIdentity.values()) {
      if (!selectedIdentities.has(candidateKey(candidate))) continue;
      for (const previous of existingCandidates) {
        if (candidateKey(previous) === candidateKey(candidate)) nextSelected.delete(previous.token);
      }
      nextSelected.add(candidate.token);
    }
    groups = groups.filter((group) => providerKey(group.provider) !== key);
    groups.push({ ...next, candidates: [...byIdentity.values()] });
  }
  return { groups, selected: nextSelected };
}

export function buildImportRows(
  candidates: ReadonlyArray<ExternalThreadImportCandidate>,
  outcomes: ReadonlyArray<ExternalThreadImportOutcome>,
): ExternalThreadImportRow[] {
  const outcomeByToken = new Map(outcomes.map((outcome) => [outcome.token, outcome]));
  return candidates.map((candidate) => ({
    candidate,
    ...(outcomeByToken.has(candidate.token)
      ? { outcome: outcomeByToken.get(candidate.token)! }
      : {}),
  }));
}

export function providerDisplayName(driver: string): string {
  if (driver === "claudeAgent") return "Claude";
  if (driver === "codex") return "Codex";
  if (driver === "grok") return "Grok Build";
  return driver;
}

export function createExternalThreadImportDialogRequestGuard() {
  let generation = 0;
  let activeTargetKey: string | null = null;
  let importInFlight = false;
  const loadsInFlight = new Set<string>();
  return {
    activate(targetKey: string): number {
      generation += 1;
      activeTargetKey = targetKey;
      importInFlight = false;
      loadsInFlight.clear();
      return generation;
    },
    invalidate(): void {
      generation += 1;
      activeTargetKey = null;
      importInFlight = false;
      loadsInFlight.clear();
    },
    isCurrent(requestGeneration: number, targetKey: string): boolean {
      return requestGeneration === generation && targetKey === activeTargetKey;
    },
    tryStartImport(requestGeneration: number, targetKey: string): boolean {
      if (!this.isCurrent(requestGeneration, targetKey) || importInFlight) return false;
      importInFlight = true;
      return true;
    },
    finishImport(requestGeneration: number, targetKey: string): boolean {
      if (!this.isCurrent(requestGeneration, targetKey)) return false;
      importInFlight = false;
      return true;
    },
    tryStartLoad(requestGeneration: number, targetKey: string, cursorKey: string): boolean {
      if (!this.isCurrent(requestGeneration, targetKey) || loadsInFlight.has(cursorKey))
        return false;
      loadsInFlight.add(cursorKey);
      return true;
    },
    finishLoad(requestGeneration: number, targetKey: string, cursorKey: string): boolean {
      if (!this.isCurrent(requestGeneration, targetKey)) return false;
      loadsInFlight.delete(cursorKey);
      return true;
    },
  };
}

export function openImportedThread(input: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly onClose: () => void;
  readonly onOpenThread: (environmentId: EnvironmentId, threadId: ThreadId) => void;
}): void {
  input.onClose();
  input.onOpenThread(input.environmentId, input.threadId);
}

export function retryImportDiscovery<T, C>(input: {
  readonly target: T;
  readonly generation: number;
  readonly cursor: C | undefined;
  readonly load: (target: T, generation: number, cursor: C) => void;
}): boolean {
  if (input.cursor === undefined) return false;
  input.load(input.target, input.generation, input.cursor);
  return true;
}
