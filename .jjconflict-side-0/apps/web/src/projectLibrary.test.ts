import { describe, expect, it } from "vite-plus/test";

import { projectSourceFromRoot, repositoryDefaultSelected } from "./projectLibrary";

describe("projectSourceFromRoot", () => {
  it("creates a stable source identity from its root", () => {
    expect(projectSourceFromRoot("/Volumes/dev")).toMatchObject({
      id: "source:%2FVolumes%2Fdev",
      root: "/Volumes/dev",
      label: "dev",
      lastScanCompletedAt: null,
      lastRepositoryCount: 0,
    });
  });
});

describe("repositoryDefaultSelected", () => {
  it("selects new repositories", () => {
    expect(repositoryDefaultSelected({ existingProject: false, availableSessionCount: 0 })).toBe(
      true,
    );
  });

  it("selects existing projects only when they have importable sessions", () => {
    expect(repositoryDefaultSelected({ existingProject: true, availableSessionCount: 2 })).toBe(
      true,
    );
    expect(repositoryDefaultSelected({ existingProject: true, availableSessionCount: 0 })).toBe(
      false,
    );
  });
});
