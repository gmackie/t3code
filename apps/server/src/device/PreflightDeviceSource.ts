import {
  DeviceOperationError,
  type DevicePreflightBinding,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as ProcessRunner from "../processRunner.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";

const failure = () =>
  new DeviceOperationError({
    operation: "Preflight source verification",
    reason: "request_failed",
    cause: new Error(
      "The thread must have the bound repository, exact source commit, and a clean worktree.",
    ),
  });

/** Canonical repository identity, independent of HTTPS versus SSH transport. */
export function repositoryIdentity(remote: string): string | undefined {
  const scp = /^git@([^:]+):([^?#]+)$/.exec(remote);
  try {
    const url = new URL(scp ? `ssh://${scp[1]}/${scp[2]}` : remote);
    if (!["https:", "ssh:"].includes(url.protocol) || url.search || url.hash) return;
    const parts = url.pathname
      .replace(/\.git\/?$/, "")
      .replace(/\/$/, "")
      .split("/");
    if (parts.length !== 3 || !parts[1] || !parts[2]) return;
    return `${url.hostname.toLowerCase()}/${parts[1].toLowerCase()}/${parts[2].toLowerCase()}`;
  } catch {
    return;
  }
}

export class PreflightDeviceSource extends Context.Service<
  PreflightDeviceSource,
  {
    readonly verify: (
      threadId: ThreadId,
      binding: DevicePreflightBinding,
    ) => Effect.Effect<void, DeviceOperationError>;
  }
>()("t3/device/PreflightDeviceSource") {}

const make = Effect.gen(function* () {
  const threads = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const runner = yield* ProcessRunner.ProcessRunner;
  const verify = Effect.fn("PreflightDeviceSource.verify")(function* (
    threadId: ThreadId,
    binding: DevicePreflightBinding,
  ) {
    const thread = yield* threads.getThreadShell(threadId).pipe(Effect.mapError(failure));
    if (!thread || thread.archivedAt !== null || thread.deletedAt !== null) return yield* failure();
    const project = yield* projects.get(thread.projectId).pipe(Effect.mapError(failure));
    if (Option.isNone(project)) return yield* failure();
    const cwd = thread.worktreePath ?? project.value.workspaceRoot;
    const git = (args: ReadonlyArray<string>) =>
      runner
        .run({
          command: "git",
          args,
          cwd,
          timeout: "5 seconds",
          maxOutputBytes: 256_000,
        })
        .pipe(
          Effect.mapError(failure),
          Effect.flatMap((result) =>
            result.code === 0 &&
            !result.timedOut &&
            !result.stdoutTruncated &&
            !result.stdoutInvalidUtf8
              ? Effect.succeed(result.stdout.trim())
              : Effect.fail(failure()),
          ),
        );
    const head = yield* git(["rev-parse", "HEAD"]);
    const dirty = yield* git(["status", "--porcelain", "--untracked-files=all"]);
    const remote = yield* git(["remote", "get-url", "origin"]);
    const expectedRepository = repositoryIdentity(binding.repositoryRemote);
    if (
      head !== binding.expectedHeadSha ||
      dirty ||
      !expectedRepository ||
      repositoryIdentity(remote) !== expectedRepository
    )
      return yield* failure();
  });
  return PreflightDeviceSource.of({ verify });
});

export const layer = Layer.effect(PreflightDeviceSource, make);
