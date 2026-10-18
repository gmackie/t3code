import { BobExecutionAdmission } from "@t3tools/contracts/bobContract";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as FileSystem from "effect/FileSystem";
import { assert, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProviderInstanceId,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Exit from "effect/Exit";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as Bob from "./BobCoordination.ts";
import * as Admission from "./ExecutionAdmission.ts";

const target = {
  environmentId: "mini",
  projectId: "project",
  repository: { integrationId: "forgegraph", repositoryId: "repo" },
};
const request = {
  contractVersion: "1",
  requestId: "request-1",
  attemptId: "attempt-1",
  itemId: "item-1",
  planId: "plan-1",
  planVersion: 1,
  issueSnapshotRef: "snapshot-1",
  target,
  work: {
    title: "Implement issue",
    instructions: "Do the work",
    acceptanceCriteria: ["Tests pass"],
  },
  workspace: { baseRevision: "a".repeat(40), branch: "BOB-46-test" },
  executionProfileId: "default",
};
const config = {
  projects: {
    project: {
      target,
      issueProject: {
        integrationId: "kanbanger",
        workspaceId: "workspace",
        teamId: "team",
        projectId: "issues",
      },
    },
  },
  executionProfiles: {
    default: {
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
      runtimeMode: "full-access" as const,
    },
  },
};
const dependencies = Layer.mergeAll(
  SqlitePersistence.layerMemory,
  Layer.succeed(Bob.BobConfiguration, { read: Effect.succeed(config) }),
  Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
    getEnvironmentId: Effect.succeed(EnvironmentId.make("mini")),
  }),
);

it.effect(
  "persists admission before launch failure and recovers the same IDs through lookup",
  () => {
    const launches: Array<ThreadLaunch.ThreadLaunchInput> = [];
    const live = Admission.layer.pipe(
      Layer.provideMerge(dependencies),
      Layer.provide(
        Layer.mock(ThreadLaunch.ThreadLaunchService)({
          launch: (input) => {
            launches.push(input);
            if (launches.length === 1)
              return Effect.fail(
                new ThreadLaunch.ThreadLaunchError({
                  operation: "create-thread",
                  commandId: input.commandId,
                  projectId: input.projectId,
                  cause: "interrupted",
                }),
              );
            return Effect.succeed({
              threadId: input.threadId!,
              projection: { runs: [] } as unknown as OrchestrationV2ThreadProjection,
              resumed: true,
            });
          },
        }),
      ),
    );
    return Effect.gen(function* () {
      const service = yield* Admission.ExecutionAdmission;
      const sql = yield* SqlClient.SqlClient;
      const first = yield* Effect.exit(service.submit("bob", request, request.requestId));
      assert.isTrue(Exit.isFailure(first));
      const rows = yield* sql<{
        admission_json: string;
        launched: number;
      }>`SELECT admission_json,launched FROM bob_execution_admissions`;
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.launched, 0);
      const recovered = yield* service.find("bob", {
        contractVersion: "1",
        requestId: request.requestId,
        environmentId: "mini",
      });
      assert.equal(recovered.thread.threadId, launches[0]!.threadId);
      assert.equal(launches[1]!.commandId, launches[0]!.commandId);
      assert.deepEqual(
        recovered,
        yield* Schema.decodeUnknownEffect(Schema.fromJsonString(BobExecutionAdmission))(
          rows[0]!.admission_json,
        ),
      );
      assert.deepEqual(yield* service.submit("bob", request, request.requestId), recovered);
      assert.equal(launches.length, 2);
      const conflict = yield* Effect.exit(
        service.submit(
          "bob",
          { ...request, work: { ...request.work, title: "Changed scope" } },
          request.requestId,
        ),
      );
      assert.isTrue(Exit.isFailure(conflict));
      const otherAttempt = yield* Effect.exit(
        service.submit("bob", { ...request, requestId: "request-2" }, "request-2"),
      );
      assert.isTrue(Exit.isFailure(otherAttempt));
      const hidden = yield* Effect.exit(
        service.find("other", {
          contractVersion: "1",
          requestId: request.requestId,
          environmentId: "mini",
        }),
      );
      assert.isTrue(Exit.isFailure(hidden));
      assert.equal(launches.length, 2);
    }).pipe(Effect.provide(live));
  },
);

it.effect("rejects invalid keys and unconfigured targets before writing or launching", () => {
  let launches = 0;
  const live = Admission.layer.pipe(
    Layer.provideMerge(dependencies),
    Layer.provide(
      Layer.mock(ThreadLaunch.ThreadLaunchService)({
        launch: () => {
          launches++;
          return Effect.die("unexpected launch");
        },
      }),
    ),
  );
  return Effect.gen(function* () {
    const service = yield* Admission.ExecutionAdmission;
    const sql = yield* SqlClient.SqlClient;
    for (const [input, key] of [
      [request, "wrong"],
      [{ ...request, target: { ...target, environmentId: "bob" } }, request.requestId],
      [{ ...request, actor: "admin" }, request.requestId],
    ] as const) {
      assert.isTrue(Exit.isFailure(yield* Effect.exit(service.submit("bob", input, key))));
    }
    assert.equal((yield* sql`SELECT * FROM bob_execution_admissions`).length, 0);
    assert.equal(launches, 0);
  }).pipe(Effect.provide(live));
});

it.effect("recovers persisted admission after closing and reopening the SQLite database", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped();
    const inputs: Array<ThreadLaunch.ThreadLaunchInput> = [];
    let failLaunch = true;
    const live = () =>
      Admission.layer.pipe(
        Layer.provideMerge(SqlitePersistence.layerFromPath(`${directory}/state.sqlite`)),
        Layer.provide(Layer.succeed(Bob.BobConfiguration, { read: Effect.succeed(config) })),
        Layer.provide(
          Layer.succeed(ServerEnvironment.ServerEnvironmentIdentity, {
            getEnvironmentId: Effect.succeed(EnvironmentId.make("mini")),
          }),
        ),
        Layer.provide(
          Layer.mock(ThreadLaunch.ThreadLaunchService)({
            launch: (input) => {
              inputs.push(input);
              if (failLaunch)
                return Effect.fail(
                  new ThreadLaunch.ThreadLaunchError({
                    operation: "create-thread",
                    commandId: input.commandId,
                    projectId: input.projectId,
                    cause: "simulated crash",
                  }),
                );
              return Effect.succeed({
                threadId: input.threadId!,
                projection: { runs: [] } as unknown as OrchestrationV2ThreadProjection,
                resumed: true,
              });
            },
          }),
        ),
      );
    const stored = yield* Effect.gen(function* () {
      const service = yield* Admission.ExecutionAdmission;
      assert.isTrue(
        Exit.isFailure(yield* Effect.exit(service.submit("bob", request, request.requestId))),
      );
      const sql = yield* SqlClient.SqlClient;
      return (yield* sql<{
        admission_json: string;
      }>`SELECT admission_json FROM bob_execution_admissions`)[0]!.admission_json;
    }).pipe(Effect.provide(live()), Effect.scoped);
    failLaunch = false;
    const result = yield* Effect.gen(function* () {
      const service = yield* Admission.ExecutionAdmission;
      return yield* service.find("bob", {
        contractVersion: "1",
        requestId: request.requestId,
        environmentId: "mini",
      });
    }).pipe(Effect.provide(live()), Effect.scoped);
    assert.deepEqual(
      result,
      yield* Schema.decodeUnknownEffect(Schema.fromJsonString(BobExecutionAdmission))(stored),
    );
    assert.isTrue(inputs.length >= 2);
    assert.isTrue(
      inputs.every(
        (input) =>
          input.threadId === result.thread.threadId && input.commandId === inputs[0]!.commandId,
      ),
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);
