import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  PROJECT_SESSION_IMPORT_MAX_PAGE_SIZE,
  ProjectSource,
  ProjectSessionImportRepository,
  ProjectSessionImportScanInput,
  ProjectSessionImportScanResult,
} from "./projectSessionImport.ts";

describe("ProjectSource", () => {
  const decode = Schema.decodeUnknownSync(ProjectSource);

  it("represents a persistent repository discovery root", () => {
    expect(
      decode({
        id: "source-volumes-dev",
        root: "/Volumes/dev",
        label: "Development",
        lastScanCompletedAt: null,
        lastRepositoryCount: 0,
      }),
    ).toEqual({
      id: "source-volumes-dev",
      root: "/Volumes/dev",
      label: "Development",
      lastScanCompletedAt: null,
      lastRepositoryCount: 0,
    });
  });
});

describe("ProjectSessionImportScanInput", () => {
  const decode = Schema.decodeUnknownSync(ProjectSessionImportScanInput);

  it("accepts a bounded first-page scan rooted at a user-selected directory", () => {
    expect(
      decode({
        environmentId: "local",
        root: "/Volumes/dev",
        limit: 50,
      }),
    ).toEqual({ environmentId: "local", root: "/Volumes/dev", limit: 50 });
  });

  it("accepts an opaque continuation cursor", () => {
    expect(
      decode({
        environmentId: "local",
        root: "~/",
        cursor: "scan:next-page",
        limit: 25,
      }).cursor,
    ).toBe("scan:next-page");
  });

  it("rejects an unbounded page", () => {
    expect(() =>
      decode({
        environmentId: "local",
        root: "~/",
        limit: PROJECT_SESSION_IMPORT_MAX_PAGE_SIZE + 1,
      }),
    ).toThrow();
  });
});

describe("ProjectSessionImportRepository", () => {
  const decode = Schema.decodeUnknownSync(ProjectSessionImportRepository);

  it("represents a discovered Git root without exposing scanner internals", () => {
    expect(
      decode({
        root: "/Volumes/dev/t3code",
        name: "t3code",
      }),
    ).toEqual({ root: "/Volumes/dev/t3code", name: "t3code" });
  });
});

describe("ProjectSessionImportScanResult", () => {
  const decode = Schema.decodeUnknownSync(ProjectSessionImportScanResult);

  it("supports incremental results and scan progress", () => {
    expect(
      decode({
        repositories: [{ root: "/Volumes/dev/t3code", name: "t3code" }],
        scannedDirectoryCount: 42,
        nextCursor: "scan:continue",
      }),
    ).toEqual({
      repositories: [{ root: "/Volumes/dev/t3code", name: "t3code" }],
      scannedDirectoryCount: 42,
      nextCursor: "scan:continue",
    });
  });
});
