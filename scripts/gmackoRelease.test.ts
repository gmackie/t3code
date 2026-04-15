import { describe, expect, it } from "vitest";

import { buildGmackoReleaseVersion, shouldPublishGmackoRelease } from "./gmackoRelease.ts";

describe("buildGmackoReleaseVersion", () => {
  it("builds a prod-style prerelease version with a gmacko timestamp suffix", () => {
    expect(buildGmackoReleaseVersion("0.0.15", new Date("2026-04-15T17:05:00.000Z"))).toBe(
      "0.0.15-gmacko.202604151705",
    );
  });

  it("preserves an existing prerelease segment before appending the gmacko suffix", () => {
    expect(buildGmackoReleaseVersion("1.2.3-alpha.1", new Date("2026-04-15T17:05:00.000Z"))).toBe(
      "1.2.3-alpha.1.gmacko.202604151705",
    );
  });
});

describe("shouldPublishGmackoRelease", () => {
  it("returns false when the rebased commit already matches the latest published release", () => {
    expect(
      shouldPublishGmackoRelease({
        currentCommitish: "abc123",
        latestPublishedCommitish: "abc123",
      }),
    ).toBe(false);
  });

  it("returns true when there is no latest published release", () => {
    expect(
      shouldPublishGmackoRelease({
        currentCommitish: "abc123",
        latestPublishedCommitish: "",
      }),
    ).toBe(true);
  });

  it("returns true when the rebased commit differs from the latest published release", () => {
    expect(
      shouldPublishGmackoRelease({
        currentCommitish: "def456",
        latestPublishedCommitish: "abc123",
      }),
    ).toBe(true);
  });
});
