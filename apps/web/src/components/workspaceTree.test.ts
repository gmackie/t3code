import type { ProjectEntry } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  createVisibleWorkspaceTreeRows,
  filterWorkspaceEntries,
  isDotfilePath,
} from "./workspaceTree";

const ENTRIES: ProjectEntry[] = [
  { path: "README.md", kind: "file" },
  { path: ".env", kind: "file" },
  { path: "src", kind: "directory" },
  { path: "src/components", kind: "directory", parentPath: "src" },
  { path: "src/components/App.tsx", kind: "file", parentPath: "src/components" },
  { path: ".github", kind: "directory" },
  { path: ".github/workflows", kind: "directory", parentPath: ".github" },
  { path: ".github/workflows/ci.yml", kind: "file", parentPath: ".github/workflows" },
];

describe("workspaceTree", () => {
  it("detects dotfiles and nested dot-directories", () => {
    expect(isDotfilePath(".env")).toBe(true);
    expect(isDotfilePath(".github/workflows/ci.yml")).toBe(true);
    expect(isDotfilePath("src/components/App.tsx")).toBe(false);
  });

  it("filters dotfiles and nested entries inside dot-directories", () => {
    expect(filterWorkspaceEntries(ENTRIES, true).map((entry) => entry.path)).toEqual([
      "README.md",
      "src",
      "src/components",
      "src/components/App.tsx",
    ]);
  });

  it("builds visible rows using expand-collapse state", () => {
    expect(
      createVisibleWorkspaceTreeRows(ENTRIES, {
        expandedPaths: new Set<string>(),
        hideDotfiles: true,
      }).map((row) => `${row.depth}:${row.entry.path}`),
    ).toEqual(["0:src", "0:README.md"]);

    expect(
      createVisibleWorkspaceTreeRows(ENTRIES, {
        expandedPaths: new Set<string>(["src", "src/components"]),
        hideDotfiles: true,
      }).map((row) => `${row.depth}:${row.entry.path}`),
    ).toEqual(["0:src", "1:src/components", "2:src/components/App.tsx", "0:README.md"]);
  });
});
