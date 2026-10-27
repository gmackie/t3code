import { describe, expect, it } from "vite-plus/test";

import { normalizeSystemsPath, systemsPathKey, withSystemsPath } from "./systemsPath";

describe("systems path preference", () => {
  it("normalizes a typed folder to a project-relative path", () => {
    expect(normalizeSystemsPath("  /models/pump/ ")).toBe("models/pump");
    expect(normalizeSystemsPath("///")).toBe("");
  });

  it("keeps one folder per environment and project and forgets the project root", () => {
    const key = systemsPathKey("env-1", "project-1");
    const other = systemsPathKey("env-2", "project-1");
    const stored = withSystemsPath({ [other]: "a" }, key, "models/pump");
    expect(stored).toEqual({ [other]: "a", [key]: "models/pump" });
    expect(withSystemsPath(stored, key, "")).toEqual({ [other]: "a" });
    expect(withSystemsPath(undefined, key, "")).toEqual({});
  });
});
