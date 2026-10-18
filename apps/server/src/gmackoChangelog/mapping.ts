import type {
  GmackoChangelog,
  GmackoChangelogBuild,
  GmackoChangelogUpstreamNightly,
} from "@t3tools/contracts";
import {
  parseGmackoChangelogManifest,
  parseGmackoTag,
  parseUpstreamNightlyTag,
} from "@t3tools/shared/gmackoChangelog";
import * as Schema from "effect/Schema";

/** The fields of a GitHub REST release the changelog reads. */
export const GitHubRelease = Schema.Struct({
  tag_name: Schema.String,
  target_commitish: Schema.String,
  html_url: Schema.String,
  body: Schema.NullOr(Schema.String),
  draft: Schema.Boolean,
  published_at: Schema.NullOr(Schema.String),
});
export type GitHubRelease = typeof GitHubRelease.Type;

const gmackoStamp = (version: string) => version.slice(version.lastIndexOf(".") + 1);

/**
 * Maps GMACKO builds onto the upstream nightlies they include. A build
 * includes every nightly up to its manifest's `upstreamNightlyTag` (nightlies
 * order by upstream's run number), and each nightly is credited to the oldest
 * build that includes it. Builds without a manifest are listed but map nothing.
 */
export function mapGmackoChangelog(input: {
  readonly upstreamReleases: ReadonlyArray<GitHubRelease>;
  readonly gmackoReleases: ReadonlyArray<GitHubRelease>;
}): Pick<GmackoChangelog, "upstream" | "builds"> {
  const builds: GmackoChangelogBuild[] = [];
  for (const release of input.gmackoReleases) {
    const version = parseGmackoTag(release.tag_name);
    if (release.draft || !version) continue;
    const manifest = parseGmackoChangelogManifest(release.body ?? "");
    builds.push({
      tag: release.tag_name,
      version,
      sha: manifest?.sha ?? release.target_commitish,
      url: release.html_url,
      publishedAt: release.published_at,
      hasManifest: manifest !== undefined,
      upstreamBaseSha: manifest?.upstreamBaseSha ?? null,
      upstreamNightlyTag: manifest?.upstreamNightlyTag ?? null,
      changes: manifest?.changes ?? [],
    });
  }
  builds.sort((left, right) => gmackoStamp(right.version).localeCompare(gmackoStamp(left.version)));

  // Oldest first, so the first match below is the build that shipped it first.
  const includedThrough = builds
    .map((build) => ({
      version: build.version,
      order: build.upstreamNightlyTag
        ? (parseUpstreamNightlyTag(build.upstreamNightlyTag)?.order ?? null)
        : null,
    }))
    .toReversed();

  const upstream: Array<GmackoChangelogUpstreamNightly & { readonly order: number }> = [];
  for (const release of input.upstreamReleases) {
    const nightly = parseUpstreamNightlyTag(release.tag_name);
    if (release.draft || !nightly) continue;
    const firstBuild = includedThrough.find(
      (build) => build.order !== null && build.order >= nightly.order,
    );
    upstream.push({
      tag: release.tag_name,
      version: nightly.version,
      order: nightly.order,
      sha: release.target_commitish,
      url: release.html_url,
      publishedAt: release.published_at,
      bodyMarkdown: release.body ?? "",
      firstGmackoVersion: firstBuild?.version ?? null,
    });
  }
  upstream.sort((left, right) => right.order - left.order);

  return { upstream: upstream.map(({ order: _order, ...nightly }) => nightly), builds };
}
