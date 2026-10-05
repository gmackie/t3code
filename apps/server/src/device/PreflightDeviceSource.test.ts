import { describe, expect, it } from "@effect/vitest";
import {
  OrchestrationV2ThreadShell,
  ThreadId,
  type DevicePreflightBinding,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { ChildProcessSpawner } from "effect/unstable/process";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as PreflightDeviceSource from "./PreflightDeviceSource.ts";

const threadId = ThreadId.make("source-thread");
const binding: DevicePreflightBinding = {
  workspaceId: "workspace",
  appId: "app",
  workflowId: "workflow",
  targetId: "target",
  sourceBindingId: "source",
  expectedHeadSha: "a".repeat(40),
  repositoryRemote: "https://git.example/Owner/Repo.git",
};
const now = DateTime.makeUnsafe("2026-10-05T00:00:00Z");
const shell = Schema.decodeSync(OrchestrationV2ThreadShell)({
  createdBy: "user",
  creationSource: "web",
  id: threadId,
  projectId: "project",
  title: "Source thread",
  providerInstanceId: "codex",
  modelSelection: { instanceId: "codex", model: "test" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: "/work/branch",
  lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
  forkedFrom: null,
  activeProviderThreadId: null,
  latestRunId: null,
  activeRunId: null,
  status: "completed",
  pendingRuntimeRequest: null,
  latestVisibleMessage: null,
  latestUserMessageAt: null,
  hasActionableProposedPlan: false,
  itemCount: 0,
  visibleItemCount: 0,
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  deletedAt: null,
});
const project = Schema.decodeSync(ProjectStore.ProjectRow)({
  projectId: "project",
  title: "Project",
  workspaceRoot: "/canonical",
  defaultModelSelection: null,
  defaultThreadEnvMode: null,
  autoPull: false,
  faviconPath: null,
  projectIcon: null,
  scripts: [],
  createdAt: "2026-10-05T00:00:00Z",
  updatedAt: "2026-10-05T00:00:00Z",
  deletedAt: null,
});

function fixture(
  options: {
    head?: string;
    dirty?: string;
    remote?: string;
    worktreePath?: string | null;
    missingThread?: boolean;
    missingProject?: boolean;
    badOutput?: Partial<ProcessRunner.ProcessRunOutput>;
  } = {},
) {
  const calls: ProcessRunner.ProcessRunInput[] = [];
  const dependencies = Layer.mergeAll(
    Layer.mock(ProjectionStore.ProjectionStoreV2)({
      getThreadShell: () =>
        Effect.succeed(
          options.missingThread
            ? null
            : {
                ...shell,
                worktreePath:
                  options.worktreePath === undefined ? shell.worktreePath : options.worktreePath,
              },
        ),
    }),
    Layer.mock(ProjectStore.ProjectStoreV2)({
      get: () => Effect.succeed(options.missingProject ? Option.none() : Option.some(project)),
    }),
    Layer.mock(ProcessRunner.ProcessRunner)({
      run: (input) =>
        Effect.sync(() => {
          calls.push(input);
          const stdout =
            input.args[0] === "rev-parse"
              ? (options.head ?? binding.expectedHeadSha)
              : input.args[0] === "status"
                ? (options.dirty ?? "")
                : (options.remote ?? "git@git.example:owner/repo.git");
          return {
            code: ChildProcessSpawner.ExitCode(0),
            stdout,
            stderr: "",
            timedOut: false,
            stdoutTruncated: false,
            stderrTruncated: false,
            stdoutInvalidUtf8: false,
            stderrInvalidUtf8: false,
            ...options.badOutput,
          };
        }),
    }),
  );
  const verify = Effect.gen(function* () {
    const service = yield* PreflightDeviceSource.PreflightDeviceSource;
    yield* service.verify(threadId, binding);
  }).pipe(Effect.provide(PreflightDeviceSource.layer.pipe(Layer.provide(dependencies))));
  return { verify, calls };
}

describe("PreflightDeviceSource", () => {
  it.effect("checks the thread worktree and treats SSH and HTTPS as the same repository", () =>
    Effect.gen(function* () {
      const test = fixture();
      yield* test.verify;
      expect(test.calls.map((call) => call.cwd)).toEqual([
        "/work/branch",
        "/work/branch",
        "/work/branch",
      ]);
      expect(test.calls[1]?.args).toEqual(["status", "--porcelain", "--untracked-files=all"]);
    }),
  );

  it.effect("uses the project root only when the thread has no worktree", () =>
    Effect.gen(function* () {
      const test = fixture({ worktreePath: null });
      yield* test.verify;
      expect(test.calls.every((call) => call.cwd === "/canonical")).toBe(true);
    }),
  );

  it.effect.each([
    ["tracked changes", { dirty: " M tracked.ts" }],
    ["untracked changes", { dirty: "?? new.ts" }],
    ["a different commit", { head: "b".repeat(40) }],
    ["a different repository", { remote: "https://git.example/owner/other.git" }],
    ["a different host", { remote: "https://foreign.example/owner/repo.git" }],
    ["truncated status output", { badOutput: { stdoutTruncated: true } }],
    ["timed-out git", { badOutput: { timedOut: true } }],
    ["invalid UTF8", { badOutput: { stdoutInvalidUtf8: true } }],
    ["failed git", { badOutput: { code: ChildProcessSpawner.ExitCode(128) } }],
    ["a missing thread", { missingThread: true }],
    ["a missing project", { missingProject: true }],
  ] as const)("refuses %s", ([_name, options]) =>
    Effect.gen(function* () {
      const error = yield* fixture(options).verify.pipe(Effect.flip);
      expect(error._tag).toBe("DeviceOperationError");
      expect(error.message).not.toContain("token");
    }),
  );

  it("rejects non-repository URLs and query-bearing remotes", () => {
    for (const remote of [
      "file:///repo",
      "https://git.example/owner/repo?token=private",
      "https://git.example/owner/repo#branch",
      "https://git.example/owner/repo/extra",
    ]) {
      expect(PreflightDeviceSource.repositoryIdentity(remote)).toBeUndefined();
    }
  });
});
