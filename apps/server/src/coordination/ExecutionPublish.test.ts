import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as ProcessRunner from "../processRunner.ts";
import * as Publish from "./ExecutionPublish.ts";

const BRANCH = "BOB-82-publish-work";
const repository = { integrationId: "forgegraph", repositoryId: "repo" };

interface Forge {
  existing: Publish.PublishedPullRequest | null;
  createFails: boolean;
  created: Array<{ baseBranch: string; title: string; body: string }>;
}

// A real repository with a local bare `origin`; only the forge API is faked.
const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const process = yield* ProcessRunner.ProcessRunner;
  const root = yield* fs.makeTempDirectoryScoped();
  const cwd = `${root}/work`;
  const git = (args: ReadonlyArray<string>, at = cwd) =>
    process.run({ command: "git", args, cwd: at }).pipe(
      Effect.map((result) => {
        assert.equal(result.code, 0, result.stderr);
        return result.stdout.trim();
      }),
    );
  yield* git(["init", "--bare", "-q", `${root}/origin.git`], root);
  yield* git(["init", "-q", "-b", "main", cwd], root);
  yield* git(["config", "user.name", "Test"]);
  yield* git(["config", "user.email", "test@example.invalid"]);
  yield* fs.writeFileString(`${cwd}/base.txt`, "base\n");
  yield* git(["add", "."]);
  yield* git(["commit", "-q", "-m", "base"]);
  yield* git(["remote", "add", "origin", `${root}/origin.git`]);
  yield* git(["push", "-q", "origin", "main"]);
  const base = yield* git(["rev-parse", "HEAD"]);
  yield* git(["checkout", "-q", "-b", BRANCH]);
  const forge: Forge = { existing: null, createFails: false, created: [] };
  const port = Publish.ExecutionPublishPort.of({
    git: Publish.runGit(process),
    findOpenPullRequest: () => Effect.sync(() => forge.existing),
    defaultBranch: () => Effect.succeed("main"),
    createPullRequest: (input) =>
      forge.createFails
        ? Effect.fail(new Publish.ExecutionPublishError({ reason: "pull request creation failed" }))
        : Effect.sync(() => {
            forge.created.push(input);
            forge.existing = { number: 7, url: "https://git.example.invalid/o/r/pulls/7" };
          }),
  });
  const publish = Publish.publish({
    cwd,
    branch: BRANCH,
    baseRevision: base,
    title: "Publish the work",
    acceptanceCriteria: ["It is published"],
    itemId: "item-1",
    repository,
  }).pipe(Effect.provideService(Publish.ExecutionPublishPort, port));
  const remoteHead = git(["ls-remote", `${root}/origin.git`, `refs/heads/${BRANCH}`]).pipe(
    Effect.map((line) => line.split(/\s/)[0] ?? ""),
  );
  return { fs, cwd, root, git, forge, publish, remoteHead };
});

const live = ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer));

describe("ExecutionPublish", () => {
  it.effect("commits the worktree without secrets, pushes, and opens a pull request", () =>
    Effect.gen(function* () {
      const { fs, cwd, git, forge, publish, remoteHead } = yield* fixture;
      yield* fs.writeFileString(`${cwd}/work.txt`, "work\n");
      yield* fs.writeFileString(`${cwd}/.env.local`, "TOKEN=secret\n");
      yield* fs.writeFileString(`${cwd}/server.pem`, "secret\n");

      const result = yield* publish;

      const head = yield* git(["rev-parse", "HEAD"]);
      assert.deepStrictEqual(result, {
        publishedHead: {
          branch: BRANCH,
          commitSha: head,
          pullRequest: { repository, number: 7, url: "https://git.example.invalid/o/r/pulls/7" },
        },
      });
      assert.equal(yield* remoteHead, head);
      assert.equal(yield* git(["log", "-1", "--format=%B"]), "Publish the work\n\nRefs: BOB-82");
      assert.equal(yield* git(["show", "--name-only", "--format=", "HEAD"]), "work.txt");
      assert.include(yield* git(["status", "--porcelain"]), "?? .env.local");
      assert.equal(forge.created.length, 1);
      assert.equal(forge.created[0]!.baseBranch, "main");
      assert.include(forge.created[0]!.body, "- It is published");
      assert.include(forge.created[0]!.body, "Refs: BOB-82");
    }).pipe(Effect.scoped, Effect.provide(live)),
  );

  it.effect("reuses the open pull request for the branch", () =>
    Effect.gen(function* () {
      const { fs, cwd, forge, publish } = yield* fixture;
      forge.existing = { number: 3, url: "https://git.example.invalid/o/r/pulls/3" };
      yield* fs.writeFileString(`${cwd}/work.txt`, "work\n");
      const result = yield* publish;
      assert.equal(result.publishedHead?.pullRequest?.number, 3);
      assert.equal(forge.created.length, 0);
    }).pipe(Effect.scoped, Effect.provide(live)),
  );

  it.effect("publishes nothing when the branch has no changes", () =>
    Effect.gen(function* () {
      const { fs, cwd, git, forge, publish, remoteHead } = yield* fixture;
      // A secret alone is never committed, so it is not a change to publish.
      yield* fs.writeFileString(`${cwd}/.env`, "TOKEN=secret\n");
      assert.deepStrictEqual(yield* publish, { publishSkippedReason: "no changes" });
      assert.equal(yield* remoteHead, "");
      assert.equal(forge.created.length, 0);

      yield* git(["commit", "--allow-empty", "-q", "-m", "empty result"]);
      assert.deepStrictEqual(yield* publish, { publishSkippedReason: "no changes" });
      assert.equal(yield* remoteHead, "");
      assert.equal(forge.created.length, 0);
    }).pipe(Effect.scoped, Effect.provide(live)),
  );

  it.effect("reports a push failure without a published head", () =>
    Effect.gen(function* () {
      const { fs, cwd, root, git, forge, publish } = yield* fixture;
      yield* git(["remote", "set-url", "origin", `${root}/missing.git`]);
      yield* fs.writeFileString(`${cwd}/work.txt`, "work\n");
      assert.deepStrictEqual(yield* publish, { publishSkippedReason: "push failed" });
      assert.equal(forge.created.length, 0);
    }).pipe(Effect.scoped, Effect.provide(live)),
  );

  it.effect("reports a creation failure without a published head even after pushing", () =>
    Effect.gen(function* () {
      const { fs, cwd, git, forge, publish, remoteHead } = yield* fixture;
      forge.createFails = true;
      yield* fs.writeFileString(`${cwd}/work.txt`, "work\n");
      const result = yield* publish;
      const head = yield* git(["rev-parse", "HEAD"]);
      assert.deepStrictEqual(result, { publishSkippedReason: "pull request creation failed" });
      assert.equal(yield* remoteHead, head);
    }).pipe(Effect.scoped, Effect.provide(live)),
  );
});
