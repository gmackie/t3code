import * as Schema from "effect/Schema";

/**
 * GMACKO fork changelog. The gmacko-nightly workflow embeds a
 * {@link GmackoChangelogManifest} in every GMACKO release body
 * (scripts/gmacko-changelog.ts); the server maps those builds onto the
 * upstream nightlies they include and serves {@link GmackoChangelog} to the
 * Settings → Changelog panel.
 */

const GmackoChangelogCommit = Schema.Struct({
  sha: Schema.String,
  subject: Schema.String,
});
export type GmackoChangelogCommit = typeof GmackoChangelogCommit.Type;

/** A Forgejo pull request merged into the lane, with its fork-only commits. */
const GmackoChangelogPullRequestChange = Schema.Struct({
  kind: Schema.Literal("pr"),
  number: Schema.Number,
  title: Schema.String,
  sha: Schema.String,
  commits: Schema.Array(GmackoChangelogCommit),
  /** Commits left out of `commits` to keep the release body small. */
  omittedCommits: Schema.Number,
});
export type GmackoChangelogPullRequestChange = typeof GmackoChangelogPullRequestChange.Type;

/** A commit made on the lane directly, outside any pull request. */
const GmackoChangelogCommitChange = Schema.Struct({
  kind: Schema.Literal("commit"),
  sha: Schema.String,
  subject: Schema.String,
});
export type GmackoChangelogCommitChange = typeof GmackoChangelogCommitChange.Type;

const GmackoChangelogChange = Schema.Union([
  GmackoChangelogPullRequestChange,
  GmackoChangelogCommitChange,
]);
export type GmackoChangelogChange = typeof GmackoChangelogChange.Type;

export const GmackoChangelogManifest = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  version: Schema.String,
  sha: Schema.String,
  previousTag: Schema.NullOr(Schema.String),
  /** `git merge-base <sha> upstream/main` when the build was cut. */
  upstreamBaseSha: Schema.NullOr(Schema.String),
  /** Newest upstream nightly tag that is an ancestor of `upstreamBaseSha`. */
  upstreamNightlyTag: Schema.NullOr(Schema.String),
  changes: Schema.Array(GmackoChangelogChange),
});
export type GmackoChangelogManifest = typeof GmackoChangelogManifest.Type;

const GmackoChangelogUpstreamNightly = Schema.Struct({
  tag: Schema.String,
  version: Schema.String,
  sha: Schema.String,
  url: Schema.String,
  publishedAt: Schema.NullOr(Schema.String),
  bodyMarkdown: Schema.String,
  /** Oldest GMACKO build that includes this nightly, if any has shipped it. */
  firstGmackoVersion: Schema.NullOr(Schema.String),
});
export type GmackoChangelogUpstreamNightly = typeof GmackoChangelogUpstreamNightly.Type;

const GmackoChangelogBuild = Schema.Struct({
  tag: Schema.String,
  version: Schema.String,
  sha: Schema.String,
  url: Schema.String,
  publishedAt: Schema.NullOr(Schema.String),
  /** False for releases cut before manifests existed and not backfilled. */
  hasManifest: Schema.Boolean,
  upstreamBaseSha: Schema.NullOr(Schema.String),
  upstreamNightlyTag: Schema.NullOr(Schema.String),
  changes: Schema.Array(GmackoChangelogChange),
});
export type GmackoChangelogBuild = typeof GmackoChangelogBuild.Type;

export const GmackoChangelog = Schema.Struct({
  /** Newest first. */
  upstream: Schema.Array(GmackoChangelogUpstreamNightly),
  /** Newest first. */
  builds: Schema.Array(GmackoChangelogBuild),
  /** Version of the server answering the request. */
  installedVersion: Schema.String,
  fetchedAt: Schema.NullOr(Schema.String),
  /** Set when the latest refresh failed; the lists are then the last good copy. */
  error: Schema.NullOr(Schema.String),
});
export type GmackoChangelog = typeof GmackoChangelog.Type;

export const GmackoChangelogInput = Schema.Struct({
  refresh: Schema.optional(Schema.Boolean),
});
export type GmackoChangelogInput = typeof GmackoChangelogInput.Type;
