import type { GmackoChangelogManifest } from "@t3tools/contracts";
import { encodeGmackoChangelogManifest } from "@t3tools/shared/gmackoChangelog";
import { assert, describe, it } from "@effect/vitest";

import { type GitHubRelease, mapGmackoChangelog } from "./mapping.ts";

const release = (tag: string, overrides: Partial<GitHubRelease> = {}): GitHubRelease => ({
  tag_name: tag,
  target_commitish: `sha-${tag}`,
  html_url: `https://github.com/releases/${tag}`,
  body: "",
  draft: false,
  published_at: null,
  ...overrides,
});

const gmackoRelease = (stamp: string, upstreamNightlyTag: string | null) => {
  const manifest: GmackoChangelogManifest = {
    schemaVersion: 1,
    version: `0.0.45-gmacko.${stamp}`,
    sha: `lane-${stamp}`,
    previousTag: null,
    upstreamBaseSha: upstreamNightlyTag ? `base-${stamp}` : null,
    upstreamNightlyTag,
    changes: [{ kind: "commit", sha: `c-${stamp}`, subject: `fix: ${stamp}` }],
  };
  return release(`v0.0.45-gmacko.${stamp}`, {
    body: `## GMACKO changes\n\n${encodeGmackoChangelogManifest(manifest)}\n`,
  });
};

describe("mapGmackoChangelog", () => {
  it("credits each nightly to the oldest build that includes it", () => {
    const { upstream, builds } = mapGmackoChangelog({
      upstreamReleases: [
        release("v0.1.1-nightly.20261001.100"),
        release("v0.1.1-nightly.20261003.120"),
        release("v0.1.1-nightly.20261002.110"),
        release("v0.1.1-preview.20261002.111"),
        release("v0.1.1-nightly.20261004.130", { draft: true }),
      ],
      gmackoReleases: [
        gmackoRelease("202610030000", "v0.1.1-nightly.20261003.120"),
        gmackoRelease("202610020000", "v0.1.1-nightly.20261002.110"),
        gmackoRelease("202610025000", "v0.1.1-nightly.20261002.110"),
      ],
    });

    assert.deepStrictEqual(
      upstream.map((nightly) => [nightly.version, nightly.firstGmackoVersion]),
      [
        ["0.1.1-nightly.20261003.120", "0.0.45-gmacko.202610030000"],
        ["0.1.1-nightly.20261002.110", "0.0.45-gmacko.202610020000"],
        ["0.1.1-nightly.20261001.100", "0.0.45-gmacko.202610020000"],
      ],
    );
    assert.deepStrictEqual(
      builds.map((build) => build.version),
      ["0.0.45-gmacko.202610030000", "0.0.45-gmacko.202610025000", "0.0.45-gmacko.202610020000"],
    );
    assert.equal(builds[0]?.sha, "lane-202610030000");
  });

  it("lists builds without a manifest but maps nothing onto them", () => {
    const { upstream, builds } = mapGmackoChangelog({
      upstreamReleases: [release("v0.1.1-nightly.20261001.100")],
      gmackoReleases: [
        release("v0.0.45-gmacko.202610020000", { body: "**Full Changelog**: …" }),
        gmackoRelease("202610010000", null),
      ],
    });

    assert.deepStrictEqual(
      builds.map((build) => [build.version, build.hasManifest, build.sha]),
      [
        ["0.0.45-gmacko.202610020000", false, "sha-v0.0.45-gmacko.202610020000"],
        ["0.0.45-gmacko.202610010000", true, "lane-202610010000"],
      ],
    );
    assert.equal(upstream[0]?.firstGmackoVersion, null);
  });
});
