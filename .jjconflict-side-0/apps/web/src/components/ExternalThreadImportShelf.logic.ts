import type {
  EnvironmentId,
  ExternalThreadImportCandidate,
  ExternalThreadImportProviderDiscoveryResult,
  ProjectId,
} from "@t3tools/contracts";

import { mergeImportGroups } from "./ExternalThreadImportDialog.logic";

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

export function mergeExternalThreadImportShelfDiscovery(
  discoveries: ReadonlyArray<ExternalThreadImportShelfDiscovery>,
  target: ExternalThreadImportShelfTarget,
  groups: ReadonlyArray<ExternalThreadImportProviderDiscoveryResult>,
): ExternalThreadImportShelfDiscovery[] {
  const current = discoveries.find(
    (discovery) =>
      discovery.target.environmentId === target.environmentId &&
      discovery.target.projectId === target.projectId,
  );
  const next = {
    target,
    groups: current === undefined ? [...groups] : mergeImportGroups(current.groups, groups),
  };
  return [...discoveries.filter((discovery) => discovery !== current), next];
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
