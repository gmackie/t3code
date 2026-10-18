// @effect-diagnostics nodeBuiltinImport:off - drives a real git repository.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { parseGmackoChangelogManifest } from "@t3tools/shared/gmackoChangelog";
import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest";

import { buildGmackoChangelogManifest, renderGmackoReleaseNotes } from "./gmacko-changelog.ts";

let repo = "";
const git = (...args: string[]) =>
  NodeChildProcess.execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
let counter = 0;
const commit = (subject: string) => {
  NodeFS.writeFileSync(NodePath.join(repo, `file-${counter++}.txt`), subject);
  git("add", ".");
  git("commit", "-q", "-m", subject);
  return git("rev-parse", "HEAD");
};

// main:   u1 (nightly .100) ─ u2 (nightly .101) ─ u3 (nightly .102) ─ u4
// lane:   u1 ─ L1 ─ [tag gmacko.202610010000] ─ merge u2 ─ lockfile ─ PR 7 ─ direct ─ merge local ─ merge u3
//                                                                   └ f1, f2           └ r, r (same subject)
let pullRequestMerge = "";
let directCommit = "";
let localMerged = "";
beforeAll(() => {
  repo = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "gmacko-changelog-test-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  commit("upstream one");
  git("tag", "v0.1.1-nightly.20261001.100");
  git("checkout", "-q", "-b", "custom-local");
  commit("fork: first change");
  git("tag", "v0.0.45-gmacko.202610010000");
  git("checkout", "-q", "main");
  commit("upstream two");
  git("tag", "v0.1.1-nightly.20261002.101");
  commit("upstream three");
  git("tag", "v0.1.1-nightly.20261003.102");
  commit("upstream four, not yet a nightly");
  git("checkout", "-q", "custom-local");
  git("merge", "-q", "--no-edit", "-m", "Merge upstream/main", "v0.1.1-nightly.20261002.101");
  commit("chore: refresh lockfile after upstream merge");
  git("checkout", "-q", "-b", "feature");
  commit("feat: one --> two");
  commit("feat: polish");
  git("checkout", "-q", "custom-local");
  git(
    "merge",
    "-q",
    "--no-ff",
    "-m",
    "Merge pull request 'T3CODE-7: add a thing' (#7) from feature into custom-local",
    "feature",
  );
  pullRequestMerge = git("rev-parse", "HEAD");
  directCommit = commit("fix(ci): direct lane fix");
  git("checkout", "-q", "-b", "local", "HEAD~1");
  commit("feat: rewritten change");
  commit("feat: rewritten change");
  git("checkout", "-q", "custom-local");
  git("merge", "-q", "--no-ff", "-m", "Merge branch 'local' into custom-local", "local");
  localMerged = git("rev-parse", "local");
  git("merge", "-q", "--no-edit", "-m", "Merge upstream/main again", "v0.1.1-nightly.20261003.102");
  git("update-ref", "refs/remotes/upstream/main", "main");
});

afterAll(() => {
  if (repo) NodeFS.rmSync(repo, { recursive: true, force: true });
});

describe("buildGmackoChangelogManifest", () => {
  it("lists only fork changes and maps the build to its upstream nightly", () => {
    const manifest = buildGmackoChangelogManifest({
      cwd: repo,
      tag: "v0.0.45-gmacko.202610020000",
      head: "custom-local",
      previousTag: "v0.0.45-gmacko.202610010000",
      upstreamRef: "upstream/main",
    });

    assert.equal(manifest.version, "0.0.45-gmacko.202610020000");
    assert.equal(manifest.upstreamBaseSha, git("rev-parse", "v0.1.1-nightly.20261003.102"));
    assert.equal(manifest.upstreamNightlyTag, "v0.1.1-nightly.20261003.102");
    assert.deepStrictEqual(
      manifest.changes.map((change) =>
        change.kind === "pr"
          ? {
              kind: change.kind,
              number: change.number,
              title: change.title,
              sha: change.sha,
              commits: change.commits.map((c) => c.subject),
            }
          : { kind: change.kind, subject: change.subject, sha: change.sha },
      ),
      [
        { kind: "commit", subject: "feat: rewritten change", sha: localMerged },
        { kind: "commit", subject: "fix(ci): direct lane fix", sha: directCommit },
        {
          kind: "pr",
          number: 7,
          title: "T3CODE-7: add a thing",
          sha: pullRequestMerge,
          commits: ["feat: polish", "feat: one --> two"],
        },
      ],
    );
  });

  it("rejects tags outside the GMACKO series", () => {
    assert.throws(() =>
      buildGmackoChangelogManifest({
        cwd: repo,
        tag: "v0.1.1-nightly.20261003.102",
        head: "custom-local",
        previousTag: null,
        upstreamRef: "upstream/main",
      }),
    );
  });
});

describe("renderGmackoReleaseNotes", () => {
  it("round-trips the manifest through the release body", () => {
    const manifest = buildGmackoChangelogManifest({
      cwd: repo,
      tag: "v0.0.45-gmacko.202610020000",
      head: "custom-local",
      previousTag: "v0.0.45-gmacko.202610010000",
      upstreamRef: "upstream/main",
    });
    const notes = renderGmackoReleaseNotes(manifest, {
      repository: "gmackie/t3code",
      pullsUrl: "https://forge.example/gmackie/t3code/pulls",
    });

    assert.include(
      notes,
      "[PR 7](https://forge.example/gmackie/t3code/pulls/7): T3CODE-7: add a thing",
    );
    assert.include(notes, "Includes upstream nightly [`v0.1.1-nightly.20261003.102`]");
    assert.notInclude(notes, "#7");
    assert.deepStrictEqual(parseGmackoChangelogManifest(notes), manifest);
  });
});
