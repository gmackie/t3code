// @effect-diagnostics-next-line nodeBuiltinImport:off -- the test recomputes the receipt digest the same way.
import * as NodeCrypto from "node:crypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { type OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as Threads from "../orchestration-v2/ThreadManagementService.ts";
import * as Bob from "./BobCoordination.ts";
import * as Publish from "./ExecutionPublish.ts";
import * as Receipts from "./ExecutionReceipts.ts";

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));

it.effect(
  "preserves terminal checkpoint evidence and replays the outbox unchanged after delivery failure",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const process = yield* ProcessRunner.ProcessRunner;
      const cwd = yield* fs.makeTempDirectoryScoped();
      const git = (args: ReadonlyArray<string>) =>
        process.run({ command: "git", args, cwd }).pipe(
          Effect.map((result) => {
            assert.equal(result.code, 0, result.stderr);
            return result.stdout.trim();
          }),
        );
      yield* git(["init", "-q", "-b", "main"]);
      yield* git(["config", "user.name", "Test"]);
      yield* git(["config", "user.email", "test@example.invalid"]);
      yield* git(["init", "-q", "--bare", `${cwd}/origin.git`]);
      yield* git(["remote", "add", "origin", `${cwd}/origin.git`]);
      yield* fs.writeFileString(`${cwd}/.gitignore`, "state.sqlite*\nt3-home/\norigin.git/\n");
      yield* git(["add", "."]);
      yield* git(["commit", "-q", "-m", "base"]);
      const base = yield* git(["rev-parse", "HEAD"]);
      yield* git(["checkout", "-q", "-b", "BOB-82-work"]);
      yield* fs.writeFileString(`${cwd}/work.txt`, "terminal content\n");
      yield* git(["add", "."]);
      yield* git(["commit", "-q", "-m", "terminal checkpoint"]);
      const commit = yield* git(["rev-parse", "HEAD"]);
      yield* git(["update-ref", "refs/t3code/checkpoints/test", commit]);
      const admission = {
        contractVersion: "1",
        requestId: "request",
        attemptId: "attempt",
        executionId: "execution",
        target: {
          environmentId: "mini",
          projectId: "project",
          repository: { integrationId: "forgegraph", repositoryId: "repo" },
        },
        thread: { environmentId: "mini", projectId: "project", threadId: "thread" },
      };
      const request = {
        contractVersion: "1",
        requestId: "request",
        attemptId: "attempt",
        itemId: "item",
        planId: "plan",
        planVersion: 1,
        issueSnapshotRef: "issue",
        target: admission.target,
        work: { title: "Work", instructions: "Do it.", acceptanceCriteria: ["Done"] },
        workspace: { baseRevision: base, branch: "BOB-82-work" },
        executionProfileId: "default",
      };
      const forgeCalls = { push: 0, create: 0 };
      const publishPort = Layer.effect(
        Publish.ExecutionPublishPort,
        Effect.map(ProcessRunner.ProcessRunner, (runner) => {
          let opened = false;
          return Publish.ExecutionPublishPort.of({
            git: (at, args, reason) => {
              if (args[0] === "push") forgeCalls.push++;
              return Publish.runGit(runner)(at, args, reason);
            },
            findOpenPullRequest: () =>
              Effect.sync(() =>
                opened ? { number: 9, url: "https://git.example.invalid/9" } : null,
              ),
            defaultBranch: () => Effect.succeed("main"),
            createPullRequest: () =>
              Effect.sync(() => {
                forgeCalls.create++;
                opened = true;
              }),
          });
        }),
      );
      const bodies: Array<string> = [];
      let status = 503;
      const live = () =>
        Layer.effect(Receipts.ExecutionReceipts, Receipts.make(false)).pipe(
          Layer.provide(publishPort),
          Layer.provideMerge(SqlitePersistence.layerFromPath(`${cwd}/state.sqlite`)),
          Layer.provideMerge(ServerConfig.ServerConfig.layerTest(cwd, `${cwd}/t3-home`)),
          Layer.provide(
            Layer.succeed(Bob.BobConfiguration, {
              read: Effect.succeed({
                projects: {},
                executionProfiles: {},
                receiptCoordinator: { baseUrl: "http://bob.invalid", authToken: "receipt-token" },
              }),
            }),
          ),
          Layer.provide(
            Layer.mock(Threads.ThreadManagementService)({
              getThreadRecords: () =>
                Effect.succeed({
                  runs: [
                    {
                      id: "run",
                      status: "completed",
                      completedAt: DateTime.makeUnsafe("2026-10-10T00:00:00Z"),
                    },
                  ],
                  checkpoints: [
                    {
                      id: "checkpoint",
                      scopeId: "scope",
                      runId: "run",
                      status: "ready",
                      ref: "refs/t3code/checkpoints/test",
                    },
                  ],
                  checkpointScopes: [{ id: "scope", kind: "root_run", cwd }],
                } as unknown as OrchestrationV2ThreadProjection),
            }),
          ),
          Layer.provide(
            Layer.succeed(
              HttpClient.HttpClient,
              HttpClient.make((request) => {
                bodies.push(
                  request.body._tag === "Uint8Array"
                    ? new TextDecoder().decode(request.body.body)
                    : "",
                );
                return Effect.succeed(
                  HttpClientResponse.fromWeb(
                    request,
                    Response.json(
                      {
                        contractVersion: "1",
                        eventId: `bob-terminal-${NodeCrypto.createHash("sha256").update("request").digest("hex")}`,
                        acceptedSequence: 1,
                      },
                      { status },
                    ),
                  ),
                );
              }),
            ),
          ),
        );
      yield* Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const service = yield* Receipts.ExecutionReceipts;
        const json = yield* encodeJson(admission);
        const requestJson = yield* encodeJson(request);
        yield* sql`INSERT INTO bob_execution_admissions (request_id,attempt_id,owner,request_json,launch_json,admission_json,run_id,launched) VALUES ('request','attempt','bob',${requestJson},'{}',${json},'run',1)`;
        yield* service.flush;
        const first = yield* sql<{
          payload_json: string;
          delivered: number;
        }>`SELECT * FROM bob_execution_receipts`;
        assert.equal(first[0]!.delivered, 0);
        assert.include(first[0]!.payload_json, commit);
        const payload = JSON.parse(first[0]!.payload_json) as Record<string, unknown>;
        assert.equal(payload.outcome, "succeeded");
        assert.deepStrictEqual(payload.publishedHead, {
          branch: "BOB-82-work",
          commitSha: commit,
          pullRequest: {
            repository: admission.target.repository,
            number: 9,
            url: "https://git.example.invalid/9",
          },
        });
        assert.deepStrictEqual(forgeCalls, { push: 1, create: 1 });
        const config = yield* ServerConfig.ServerConfig;
        const bundles = yield* fs.readDirectory(`${config.stateDir}/bob-evidence`);
        assert.equal(bundles.length, 1);
        yield* git(["bundle", "verify", `${config.stateDir}/bob-evidence/${bundles[0]}`]);
        // Simulate a crash before outbox insertion with invalid pre-existing evidence.
        const bundlePath = `${config.stateDir}/bob-evidence/${bundles[0]}`;
        const savedBundle = yield* fs.readFile(bundlePath);
        yield* sql`DELETE FROM bob_execution_receipts`;
        yield* fs.writeFileString(bundlePath, "invalid bundle");
        yield* service.flush;
        assert.equal((yield* sql`SELECT * FROM bob_execution_receipts`).length, 0);
        assert.equal(bodies.length, 1);
        yield* fs.writeFile(bundlePath, savedBundle);
        yield* service.flush;
        assert.equal(bodies.length, 2);
        assert.equal(bodies[0], bodies[1]);
      }).pipe(Effect.provide(live()), Effect.scoped);
      // Rebuild the service and SQLite connection after the failed delivery.
      yield* Effect.gen(function* () {
        const service = yield* Receipts.ExecutionReceipts;
        const sql = yield* SqlClient.SqlClient;
        // The working tree changes after capture; retry must use the recorded snapshot.
        yield* fs.writeFileString(`${cwd}/work.txt`, "new unrelated content\n");
        status = 200;
        yield* service.flush;
        assert.equal(bodies.length, 3);
        assert.equal(bodies[0], bodies[2]);
        assert.equal(
          (yield* sql<{ delivered: number }>`SELECT delivered FROM bob_execution_receipts`)[0]!
            .delivered,
          1,
        );
        yield* service.flush;
        assert.equal(bodies.length, 3);
        // Rebuilding the receipt reused the stored publication: no second push or PR.
        assert.deepStrictEqual(forgeCalls, { push: 1, create: 1 });
      }).pipe(Effect.provide(live()), Effect.scoped);
    }).pipe(Effect.provide(ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer)))),
);
