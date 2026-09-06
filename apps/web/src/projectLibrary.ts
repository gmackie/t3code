import { ProjectSource, ProjectSourceId } from "@t3tools/contracts";

export function projectSourceFromRoot(root: string): ProjectSource {
  const normalizedRoot = root.trim().replace(/\/$/, "") || "/";
  const segments = normalizedRoot.split("/").filter(Boolean);
  return ProjectSource.make({
    id: ProjectSourceId.make(`source:${encodeURIComponent(normalizedRoot)}`),
    root: normalizedRoot,
    label: segments.at(-1) ?? normalizedRoot,
    lastScanCompletedAt: null,
    lastRepositoryCount: 0,
  });
}

export function repositoryDefaultSelected(input: {
  readonly existingProject: boolean;
  readonly availableSessionCount: number;
}): boolean {
  return !input.existingProject || input.availableSessionCount > 0;
}
