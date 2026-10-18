#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off - a plain git/gh wrapper run in CI.

/**
 * Writes GMACKO release notes: the fork-only changes since the previous GMACKO
 * build, the upstream nightly the build includes, and a machine-readable
 * manifest the Settings → Changelog panel reads back from the release body.
 *
 *   generate  notes for one release (gmacko-nightly sync job)
 *   backfill  notes for every existing GMACKO tag; dry run unless --apply
 *
 * Needs a clone with the lane, its GMACKO tags, upstream main, and upstream's
 * nightly tags (`git fetch upstream main --tags`).
 */

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import {
  encodeGmackoChangelogManifest,
  type GmackoChangelogChange,
  type GmackoChangelogCommit,
  type GmackoChangelogManifest,
  parseGmackoTag,
  parseUpstreamNightlyTag,
} from "@t3tools/shared/gmackoChangelog";

const UPSTREAM_REPOSITORY = "pingdotgg/t3code";
const MAX_COMMITS_PER_PULL_REQUEST = 50;
const MAX_CHANGES = 150;
const LOCKFILE_REFRESH_SUBJECT = "chore: refresh lockfile after upstream merge";
const PULL_REQUEST_MERGE = /^Merge pull request '(.+)' \(#(\d+)\)/;
const FIELD = "\x1f";

const git = (cwd: string, args: ReadonlyArray<string>): string =>
  NodeChildProcess.execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).trim();

const lines = (output: string) => output.split("\n").filter((line) => line.length > 0);

function logCommits(cwd: string, args: ReadonlyArray<string>): GmackoChangelogCommit[] {
  return lines(git(cwd, ["log", `--format=%H${FIELD}%s`, ...args])).map((line) => {
    const [sha = "", subject = ""] = line.split(FIELD);
    return { sha, subject };
  });
}

/**
 * Lane changes in `previousTag..head` that upstream can't reach, newest first.
 * Walks the lane's first-parent history: Forgejo PR merges become `pr`
 * entries holding their own commits; upstream syncs and the lockfile refresh
 * contribute nothing.
 */
function collectGmackoChanges(options: {
  readonly cwd: string;
  readonly head: string;
  readonly previousTag: string | null;
  readonly upstreamRef: string;
}): GmackoChangelogChange[] {
  const { cwd, head, previousTag, upstreamRef } = options;
  const range = previousTag ? `${previousTag}..${head}` : head;
  const firstParents = lines(
    git(cwd, [
      "log",
      "--first-parent",
      `--format=%H${FIELD}%P${FIELD}%s`,
      range,
      `^${upstreamRef}`,
    ]),
  );

  const changes: GmackoChangelogChange[] = [];
  for (const line of firstParents) {
    const [sha = "", parentList = "", subject = ""] = line.split(FIELD);
    const [firstParent] = parentList.split(" ");
    const isMerge = parentList.includes(" ");
    if (!isMerge) {
      if (subject !== LOCKFILE_REFRESH_SUBJECT) changes.push({ kind: "commit", sha, subject });
      continue;
    }
    // Commits this merge brought in that neither the lane nor upstream had.
    const merged = logCommits(cwd, ["--no-merges", `${firstParent}..${sha}`, `^${upstreamRef}`]);
    const pullRequest = PULL_REQUEST_MERGE.exec(subject);
    if (pullRequest?.[1] && pullRequest[2]) {
      changes.push({
        kind: "pr",
        number: Number(pullRequest[2]),
        title: pullRequest[1],
        sha,
        commits: merged.slice(0, MAX_COMMITS_PER_PULL_REQUEST),
        omittedCommits: Math.max(0, merged.length - MAX_COMMITS_PER_PULL_REQUEST),
      });
      continue;
    }
    // Other merges (upstream syncs, local branch merges): keep only fork work.
    // Rewritten history (jj, rebases) can bring the same change in several
    // times; list each subject once.
    const subjects = new Set<string>();
    for (const commit of merged) {
      if (subjects.has(commit.subject)) continue;
      subjects.add(commit.subject);
      changes.push({ kind: "commit", ...commit });
    }
  }
  return changes.slice(0, MAX_CHANGES);
}

/** Newest upstream nightly tag reachable from `commit`. */
function resolveUpstreamNightlyTag(cwd: string, commit: string): string | null {
  let newest: { tag: string; order: number } | null = null;
  for (const tag of lines(git(cwd, ["tag", "--list", "v*-nightly.*", "--merged", commit]))) {
    const parsed = parseUpstreamNightlyTag(tag);
    if (parsed && (!newest || parsed.order > newest.order)) newest = { tag, order: parsed.order };
  }
  return newest?.tag ?? null;
}

export function buildGmackoChangelogManifest(options: {
  readonly cwd: string;
  readonly tag: string;
  readonly head: string;
  readonly previousTag: string | null;
  readonly upstreamRef: string;
}): GmackoChangelogManifest {
  const { cwd, tag, head, previousTag, upstreamRef } = options;
  const version = parseGmackoTag(tag);
  if (!version) throw new Error(`Not a GMACKO release tag: '${tag}'.`);
  const sha = git(cwd, ["rev-parse", `${head}^{commit}`]);
  let upstreamBaseSha: string | null = null;
  try {
    upstreamBaseSha = git(cwd, ["merge-base", sha, upstreamRef]);
  } catch {
    // No shared history with upstream (shallow clone or unrelated ref).
  }
  return {
    schemaVersion: 1,
    version,
    sha,
    previousTag,
    upstreamBaseSha,
    upstreamNightlyTag: upstreamBaseSha ? resolveUpstreamNightlyTag(cwd, upstreamBaseSha) : null,
    changes: collectGmackoChanges({ cwd, head: sha, previousTag, upstreamRef }),
  };
}

const short = (sha: string) => sha.slice(0, 7);
// A bare `#30` would autolink to the GitHub fork's PR 30, which is unrelated.
const pullRequestLabel = (number: number, pullsUrl: string | undefined) =>
  pullsUrl ? `[PR ${number}](${pullsUrl}/${number})` : `PR ${number}`;

export function renderGmackoReleaseNotes(
  manifest: GmackoChangelogManifest,
  options: { readonly repository: string; readonly pullsUrl?: string | undefined },
): string {
  const out: string[] = ["## GMACKO changes", ""];
  if (manifest.changes.length === 0) out.push("No fork changes since the previous build.");
  for (const change of manifest.changes) {
    if (change.kind === "commit") {
      out.push(`- ${change.subject} (\`${short(change.sha)}\`)`);
      continue;
    }
    out.push(`- ${pullRequestLabel(change.number, options.pullsUrl)}: ${change.title}`);
    if (change.commits.length > 1 || change.omittedCommits > 0) {
      for (const commit of change.commits) {
        out.push(`  - ${commit.subject} (\`${short(commit.sha)}\`)`);
      }
      if (change.omittedCommits > 0) out.push(`  - …and ${change.omittedCommits} more`);
    }
  }
  out.push("");
  if (manifest.upstreamNightlyTag) {
    const url = `https://github.com/${UPSTREAM_REPOSITORY}/releases/tag/${manifest.upstreamNightlyTag}`;
    out.push(`Includes upstream nightly [\`${manifest.upstreamNightlyTag}\`](${url}).`);
  } else if (manifest.upstreamBaseSha) {
    out.push(`Includes upstream \`main\` up to \`${short(manifest.upstreamBaseSha)}\`.`);
  }
  if (manifest.previousTag) {
    out.push(
      "",
      `**Full Changelog**: https://github.com/${options.repository}/compare/${manifest.previousTag}...v${manifest.version}`,
    );
  }
  out.push("", encodeGmackoChangelogManifest(manifest), "");
  return out.join("\n");
}

/** GMACKO tags in release order (their stamps sort chronologically). */
function listGmackoTags(cwd: string): string[] {
  return lines(git(cwd, ["tag", "--list", "v*-gmacko.*"]))
    .filter((tag) => parseGmackoTag(tag) !== undefined)
    .toSorted((left, right) =>
      left.slice(left.lastIndexOf(".")).localeCompare(right.slice(right.lastIndexOf("."))),
    );
}

function main() {
  const { positionals, values } = NodeUtil.parseArgs({
    allowPositionals: true,
    options: {
      tag: { type: "string" },
      "previous-tag": { type: "string" },
      head: { type: "string", default: "HEAD" },
      "upstream-ref": { type: "string", default: "upstream/main" },
      repository: { type: "string", default: "gmackie/t3code" },
      "pulls-url": { type: "string" },
      output: { type: "string" },
      "out-dir": { type: "string" },
      apply: { type: "boolean", default: false },
    },
  });
  const cwd = process.cwd();
  const upstreamRef = values["upstream-ref"];
  const renderOptions = { repository: values.repository, pullsUrl: values["pulls-url"] };

  if (positionals[0] === "generate") {
    if (!values.tag) throw new Error("generate needs --tag.");
    const manifest = buildGmackoChangelogManifest({
      cwd,
      tag: values.tag,
      head: values.head,
      previousTag: values["previous-tag"] || null,
      upstreamRef,
    });
    const notes = renderGmackoReleaseNotes(manifest, renderOptions);
    if (values.output) NodeFS.writeFileSync(values.output, notes);
    else process.stdout.write(notes);
    return;
  }

  if (positionals[0] === "backfill") {
    const outDir =
      values["out-dir"] ?? NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "gmacko-changelog-"));
    NodeFS.mkdirSync(outDir, { recursive: true });
    const tags = listGmackoTags(cwd);
    tags.forEach((tag, index) => {
      const manifest = buildGmackoChangelogManifest({
        cwd,
        tag,
        head: tag,
        previousTag: tags[index - 1] ?? null,
        upstreamRef,
      });
      const notesPath = NodePath.join(outDir, `${tag}.md`);
      NodeFS.writeFileSync(notesPath, renderGmackoReleaseNotes(manifest, renderOptions));
      const summary = `${tag}: ${manifest.changes.length} change(s), upstream ${manifest.upstreamNightlyTag ?? "none"}`;
      if (!values.apply) {
        process.stdout.write(`${summary}\n`);
        return;
      }
      try {
        NodeChildProcess.execFileSync(
          "gh",
          ["release", "edit", tag, "--repo", values.repository, "--notes-file", notesPath],
          {
            stdio: ["ignore", "ignore", "pipe"],
          },
        );
        process.stdout.write(`${summary} → updated\n`);
      } catch (error) {
        process.stdout.write(`${summary} → skipped (${String(error).split("\n")[0]})\n`);
      }
    });
    process.stdout.write(`Notes written to ${outDir}\n`);
    return;
  }

  throw new Error("Usage: gmacko-changelog.ts generate --tag <tag> [...] | backfill [--apply]");
}

if (import.meta.main) main();
