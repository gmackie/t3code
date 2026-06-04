import { describe, expect, it } from "vitest";

import { createVisibleWorkspaceTreeRows, filterWorkspaceEntries } from "./workspaceTree";

describe("workspaceTree", () => {
  it("filters dotfiles recursively when requested", () => {
    const visibleEntries = filterWorkspaceEntries(
      [
        { path: ".gitignore", kind: "file" },
        { path: "src", kind: "directory" },
        { path: "src/index.ts", kind: "file", parentPath: "src" },
        { path: ".github", kind: "directory" },
        { path: ".github/workflows", kind: "directory", parentPath: ".github" },
      ],
      true,
    );

    expect(visibleEntries).toEqual([
      { path: "src", kind: "directory" },
      { path: "src/index.ts", kind: "file", parentPath: "src" },
    ]);
  });

  it("creates visible rows using directory expansion state", () => {
    const rows = createVisibleWorkspaceTreeRows(
      [
        { path: "README.md", kind: "file" },
        { path: "src", kind: "directory" },
        { path: "src/components", kind: "directory", parentPath: "src" },
        { path: "src/components/Sidebar.tsx", kind: "file", parentPath: "src/components" },
        { path: "src/index.ts", kind: "file", parentPath: "src" },
      ],
      {
        expandedPaths: new Set(["src", "src/components"]),
        hideDotfiles: true,
      },
    );

    expect(rows.map((row) => [row.entry.path, row.depth, row.expanded])).toEqual([
      ["src", 0, true],
      ["src/components", 1, true],
      ["src/components/Sidebar.tsx", 2, false],
      ["src/index.ts", 1, false],
      ["README.md", 0, false],
    ]);
  });
});
