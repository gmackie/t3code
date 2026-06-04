import type { ProjectEntry } from "@t3tools/contracts";

import { basenameOfPath } from "../vscode-icons";

const ROOT_PARENT_KEY = "\u0000root";

export interface WorkspaceTreeRow {
  entry: ProjectEntry;
  depth: number;
  expanded: boolean;
}

function parentKey(parentPath: string | undefined): string {
  return parentPath ?? ROOT_PARENT_KEY;
}

function compareEntries(left: ProjectEntry, right: ProjectEntry): number {
  if (left.kind !== right.kind) {
    return left.kind === "directory" ? -1 : 1;
  }

  const leftName = basenameOfPath(left.path).toLowerCase();
  const rightName = basenameOfPath(right.path).toLowerCase();
  const nameDelta = leftName.localeCompare(rightName);
  if (nameDelta !== 0) {
    return nameDelta;
  }

  return left.path.localeCompare(right.path);
}

export function isDotfilePath(pathValue: string): boolean {
  return pathValue.split("/").some((segment) => segment.startsWith("."));
}

export function filterWorkspaceEntries(
  entries: readonly ProjectEntry[],
  hideDotfiles: boolean,
): ProjectEntry[] {
  if (!hideDotfiles) {
    return [...entries];
  }

  return entries.filter((entry) => !isDotfilePath(entry.path));
}

export function createVisibleWorkspaceTreeRows(
  entries: readonly ProjectEntry[],
  options: {
    expandedPaths: ReadonlySet<string>;
    hideDotfiles: boolean;
  },
): WorkspaceTreeRow[] {
  const visibleEntries = filterWorkspaceEntries(entries, options.hideDotfiles);
  const childrenByParent = new Map<string, ProjectEntry[]>();

  for (const entry of visibleEntries) {
    const key = parentKey(entry.parentPath);
    const existing = childrenByParent.get(key);
    if (existing) {
      existing.push(entry);
      continue;
    }
    childrenByParent.set(key, [entry]);
  }

  for (const children of childrenByParent.values()) {
    children.sort(compareEntries);
  }

  const rows: WorkspaceTreeRow[] = [];
  const walk = (nextParentPath: string | undefined, depth: number) => {
    const children = childrenByParent.get(parentKey(nextParentPath)) ?? [];
    for (const entry of children) {
      const expanded = entry.kind === "directory" && options.expandedPaths.has(entry.path);
      rows.push({ entry, depth, expanded });
      if (expanded) {
        walk(entry.path, depth + 1);
      }
    }
  };

  walk(undefined, 0);
  return rows;
}
