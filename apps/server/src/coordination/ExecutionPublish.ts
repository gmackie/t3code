import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as ProcessRunner from "../processRunner.ts";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import { sourceControlDefinitions } from "../sourceControl/sourceControlDefinitions.ts";

// A failed step carries a fixed reason only. Git and forge output can contain
// remote URLs with credentials, so it never reaches the receipt.
export class ExecutionPublishError extends Schema.TaggedError<ExecutionPublishError>()(
  "ExecutionPublishError",
  { reason: Schema.String },
) {}

export interface PublishedPullRequest {
  readonly number: number;
  readonly url: string;
}

const RepositoryRef = Schema.Struct({ integrationId: Schema.String, repositoryId: Schema.String });
export const PublishResult = Schema.Struct({
  publishedHead: Schema.optionalKey(
    Schema.Struct({
      branch: Schema.String,
      commitSha: Schema.String,
      pullRequest: Schema.optionalKey(
        Schema.Struct({
          repository: RepositoryRef,
          number: Schema.Number,
          url: Schema.optionalKey(Schema.String),
        }),
      ),
    }),
  ),
  publishSkippedReason: Schema.optionalKey(Schema.String),
});
export type PublishResult = typeof PublishResult.Type;

export interface PublishInput {
  readonly cwd: string;
  readonly branch: string;
  readonly baseRevision: string;
  readonly title: string;
  readonly acceptanceCriteria: ReadonlyArray<string>;
  readonly itemId: string;
  readonly repository: { readonly integrationId: string; readonly repositoryId: string };
}

/** Git and pull request operations the publish step needs, injectable for tests. */
export class ExecutionPublishPort extends Context.Service<
  ExecutionPublishPort,
  {
    /** Runs git in `cwd` and returns trimmed stdout; a non-zero exit fails with `reason`. */
    readonly git: (
      cwd: string,
      args: ReadonlyArray<string>,
      reason: string,
    ) => Effect.Effect<string, ExecutionPublishError>;
    readonly findOpenPullRequest: (input: {
      readonly cwd: string;
      readonly branch: string;
    }) => Effect.Effect<PublishedPullRequest | null, ExecutionPublishError>;
    readonly defaultBranch: (cwd: string) => Effect.Effect<string | null, ExecutionPublishError>;
    readonly createPullRequest: (input: {
      readonly cwd: string;
      readonly branch: string;
      readonly baseBranch: string;
      readonly title: string;
      readonly body: string;
    }) => Effect.Effect<void, ExecutionPublishError>;
  }
>()("t3/coordination/ExecutionPublish/ExecutionPublishPort") {}

const SECRET_PATHSPECS = [
  ":(exclude,glob)**/.env*",
  ":(exclude,glob)**/*.pem",
  ":(exclude,glob)**/*.key",
];
const isSecretPath = (path: string): boolean => {
  const name = path.split("/").at(-1) ?? path;
  return name.startsWith(".env") || name.endsWith(".pem") || name.endsWith(".key");
};
const splitNul = (output: string) => output.split("\0").filter((entry) => entry.length > 0);

/** Paths named by `git status --porcelain=v1 -z`, including both sides of a rename. */
const statusPaths = (output: string): ReadonlyArray<string> => {
  const records = output.split("\0");
  const paths: Array<string> = [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index]!;
    if (record.length < 4) continue;
    paths.push(record.slice(3));
    if (record[0] === "R" || record[0] === "C") paths.push(records[++index] ?? "");
  }
  return paths.filter((path) => path.length > 0);
};

const issueIdentifier = (branch: string): string | null =>
  /(?:^|\/)([A-Z][A-Z0-9]*-\d+)(?=$|[-_/.])/.exec(branch)?.[1] ?? null;

const publishExecution = Effect.fn("ExecutionPublish.publish")(function* (input: PublishInput) {
  const port = yield* ExecutionPublishPort;
  const git = (args: ReadonlyArray<string>, reason: string) => port.git(input.cwd, args, reason);
  const issue = issueIdentifier(input.branch);

  const current = yield* git(
    ["symbolic-ref", "--quiet", "--short", "HEAD"],
    "worktree is not on the admitted branch",
  );
  if (current !== input.branch)
    return yield* new ExecutionPublishError({ reason: "worktree is not on the admitted branch" });

  // 1. Commit what the run left uncommitted, never secret-looking files.
  const changed = statusPaths(
    yield* git(
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      "could not read worktree status",
    ),
  );
  const leftSecrets = changed.filter(isSecretPath);
  if (changed.some((path) => !isSecretPath(path))) {
    yield* git(["add", "-A", "--", ".", ...SECRET_PATHSPECS], "could not stage changes");
    // A secret the agent staged itself is unstaged, not committed.
    const stagedSecrets = splitNul(
      yield* git(["diff", "--cached", "--name-only", "-z"], "could not read staged changes"),
    ).filter(isSecretPath);
    if (stagedSecrets.length > 0)
      yield* git(["reset", "-q", "--", ...stagedSecrets], "could not unstage secret files");
    const staged = yield* git(
      ["diff", "--cached", "--name-only", "-z"],
      "could not read staged changes",
    );
    if (staged.length > 0)
      yield* git(
        [
          "commit",
          "--no-verify",
          "-q",
          "-m",
          issue ? `${input.title}\n\nRefs: ${issue}` : input.title,
        ],
        "could not commit worktree changes",
      );
  }
  if (leftSecrets.length > 0)
    yield* Effect.logWarning("Bob publish left secret-looking files uncommitted.", {
      count: leftSecrets.length,
    });

  // 2. Nothing beyond the admitted base means nothing to publish.
  const base = yield* git(
    ["rev-parse", "--verify", "--quiet", `${input.baseRevision}^{commit}`],
    "base revision not found",
  );
  const head = yield* git(["rev-parse", "--verify", "HEAD^{commit}"], "could not resolve HEAD");
  const ahead = yield* git(
    ["rev-list", "--count", `${base}..${head}`],
    "could not compare with base",
  );
  if (ahead === "0") return { publishSkippedReason: "no changes" } satisfies PublishResult;
  const touched = splitNul(
    yield* git(["diff", "--name-only", "-z", base, head], "could not compare with base"),
  );
  if (touched.length === 0) return { publishSkippedReason: "no changes" } satisfies PublishResult;
  if (touched.some(isSecretPath))
    return yield* new ExecutionPublishError({
      reason: "branch contains secret-looking files; not published",
    });

  // 3. Push. The branch belongs to this attempt, so lease against what origin has now.
  const ref = `refs/heads/${input.branch}`;
  const remote = (yield* git(["ls-remote", "origin", ref], "push failed")).split(/\s/)[0] ?? "";
  if (remote !== head)
    yield* git(
      [
        "push",
        "--no-verify",
        "--quiet",
        `--force-with-lease=${ref}:${remote}`,
        "origin",
        `${head}:${ref}`,
      ],
      "push failed",
    );

  // Receipt consumers need a reviewable PR before trusting publishedHead.
  const pullRequest = yield* Effect.gen(function* () {
    const existing = yield* port.findOpenPullRequest({ cwd: input.cwd, branch: input.branch });
    if (existing) return existing;
    const baseBranch = yield* port.defaultBranch(input.cwd);
    if (!baseBranch) return yield* new ExecutionPublishError({ reason: "default branch unknown" });
    const body = [
      input.acceptanceCriteria.length > 0
        ? `Acceptance criteria:\n${input.acceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n")}`
        : null,
      `Bob work item: ${input.itemId}`,
      issue ? `Refs: ${issue}` : null,
    ]
      .filter((part) => part !== null)
      .join("\n\n");
    yield* port.createPullRequest({
      cwd: input.cwd,
      branch: input.branch,
      baseBranch,
      title: input.title,
      body,
    });
    const created = yield* port.findOpenPullRequest({ cwd: input.cwd, branch: input.branch });
    if (!created) return yield* new ExecutionPublishError({ reason: "pull request lookup failed" });
    return created;
  });
  return {
    publishedHead: {
      branch: input.branch,
      commitSha: head,
      pullRequest: {
        repository: input.repository,
        number: pullRequest.number,
        ...(pullRequest.url ? { url: pullRequest.url } : {}),
      },
    },
  } satisfies PublishResult;
});

/** Publishes a succeeded run. Never fails: a failure becomes `publishSkippedReason`. */
export const publish = (input: PublishInput) =>
  publishExecution(input).pipe(
    Effect.timeout("3 minutes"),
    Effect.map((result): PublishResult => result),
    Effect.catch((error) =>
      Effect.succeed<PublishResult>({
        publishSkippedReason:
          error._tag === "ExecutionPublishError" ? error.reason : "publish timed out",
      }),
    ),
    Effect.catchDefect(() =>
      Effect.succeed<PublishResult>({ publishSkippedReason: "publish failed" }),
    ),
  );

/** The live `git` port operation. */
export const runGit =
  (process: ProcessRunner.ProcessRunner["Service"]): ExecutionPublishPort["Service"]["git"] =>
  (cwd, args, reason) =>
    process
      .run({
        command: "git",
        args: ["--no-optional-locks", ...args],
        cwd,
        timeout: args[0] === "push" || args[0] === "ls-remote" ? "90 seconds" : "30 seconds",
        maxOutputBytes: 1024 * 1024,
        // Never block on a credential prompt.
        env: {
          GCM_INTERACTIVE: "never",
          GIT_ASKPASS: "",
          GIT_TERMINAL_PROMPT: "0",
          SSH_ASKPASS: "",
          SSH_ASKPASS_REQUIRE: "never",
        },
      })
      .pipe(
        Effect.mapError(() => new ExecutionPublishError({ reason })),
        Effect.flatMap((result) =>
          result.code === 0 && !result.stdoutTruncated
            ? Effect.succeed(result.stdout.trim())
            : Effect.fail(new ExecutionPublishError({ reason })),
        ),
      );

const make = Effect.gen(function* () {
  const process = yield* ProcessRunner.ProcessRunner;
  const registry = yield* SourceControlProviderRegistry.SourceControlProviderRegistry;
  const fs = yield* FileSystem.FileSystem;
  const git = runGit(process);
  // The same forge provider (and its fj/tea/gh credentials) the git panel uses for `origin`.
  const provider = Effect.fn("ExecutionPublishPort.provider")(function* (cwd: string) {
    const remoteUrl = yield* git(
      cwd,
      ["config", "--get", "remote.origin.url"],
      "pull request host unknown",
    );
    const info = sourceControlDefinitions.recognizeRemote(remoteUrl);
    if (!info) return yield* new ExecutionPublishError({ reason: "pull request host unknown" });
    const handle = yield* registry
      .resolveHandle({ cwd, context: { provider: info, remoteName: "origin", remoteUrl } })
      .pipe(
        Effect.mapError(() => new ExecutionPublishError({ reason: "pull request host unknown" })),
      );
    return handle.provider;
  });
  const findOpenPullRequest = Effect.fn("ExecutionPublishPort.findOpenPullRequest")(
    function* (input: { readonly cwd: string; readonly branch: string }) {
      const forge = yield* provider(input.cwd);
      const requests = yield* forge.listChangeRequests({
        cwd: input.cwd,
        headSelector: input.branch,
        state: "open",
        limit: 10,
      });
      const match = requests.find((request) => request.headRefName === input.branch);
      return match ? { number: match.number, url: match.url } : null;
    },
    Effect.mapError(() => new ExecutionPublishError({ reason: "pull request lookup failed" })),
  );
  const defaultBranch = Effect.fn("ExecutionPublishPort.defaultBranch")(
    function* (cwd: string) {
      const forge = yield* provider(cwd);
      return yield* forge.getDefaultBranch({ cwd });
    },
    Effect.mapError(() => new ExecutionPublishError({ reason: "default branch unknown" })),
  );
  const createPullRequest = Effect.fn("ExecutionPublishPort.createPullRequest")(
    function* (input: {
      readonly cwd: string;
      readonly branch: string;
      readonly baseBranch: string;
      readonly title: string;
      readonly body: string;
    }) {
      const forge = yield* provider(input.cwd);
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-bob-pr-" });
      const bodyFile = `${directory}/body.md`;
      yield* fs.writeFileString(bodyFile, input.body);
      yield* forge.createChangeRequest({
        cwd: input.cwd,
        baseRefName: input.baseBranch,
        headSelector: input.branch,
        title: input.title,
        bodyFile,
      });
    },
    Effect.scoped,
    Effect.mapError(() => new ExecutionPublishError({ reason: "pull request creation failed" })),
  );
  return ExecutionPublishPort.of({ git, findOpenPullRequest, defaultBranch, createPullRequest });
});

export const layer = Layer.effect(ExecutionPublishPort, make);
