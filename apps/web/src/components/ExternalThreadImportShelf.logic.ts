import type {
  EnvironmentId,
  ExternalThreadImportCandidate,
  ExternalThreadImportProviderDiscoveryResult,
  ProjectId,
} from "@t3tools/contracts";

export interface ExternalThreadImportShelfTarget {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}

export interface ExternalThreadImportShelfDiscovery {
  readonly target: ExternalThreadImportShelfTarget;
  readonly groups: ReadonlyArray<ExternalThreadImportProviderDiscoveryResult>;
}

export interface ExternalThreadImportShelfRow {
  readonly target: ExternalThreadImportShelfTarget;
  readonly candidate: ExternalThreadImportCandidate;
}

export function buildExternalThreadImportShelfRows(
  discoveries: ReadonlyArray<ExternalThreadImportShelfDiscovery>,
): ExternalThreadImportShelfRow[] {
  const rows: ExternalThreadImportShelfRow[] = [];
  for (const discovery of discoveries) {
    for (const group of discovery.groups) {
      if (group._tag !== "Success") continue;
      for (const candidate of group.candidates) {
        if (candidate.status._tag !== "Available") continue;
        rows.push({ target: discovery.target, candidate });
      }
    }
  }
  return rows.toSorted(
    (left, right) => Date.parse(right.candidate.updatedAt) - Date.parse(left.candidate.updatedAt),
  );
}
