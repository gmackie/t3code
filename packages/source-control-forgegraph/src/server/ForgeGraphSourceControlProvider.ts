import {
  SourceControlProviderError,
  SourceControlProviderKind,
  type ChangeRequest,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  providerAuth,
  type SourceControlManagedCliDiscoverySpec,
} from "@t3tools/source-control-core/server/discovery";
import * as SourceControlHost from "@t3tools/source-control-core/server/SourceControlHost";
import * as SourceControlProvider from "@t3tools/source-control-core/server/SourceControlProvider";

import * as ForgeGraphApi from "./ForgeGraphApi.ts";
import * as ForgeGraphHosts from "./forgeGraphHosts.ts";
import * as Json from "./forgeGraphJson.ts";
import * as ForgeGraphLookups from "./forgeGraphLookups.ts";

const KIND = SourceControlProviderKind.make("forgegraph");
const LABEL = "ForgeGraph";
const INSTALL_HINT =
  "Sign in to ForgeGraph from Settings → Source Control, set FG_API_TOKEN on the server, or run `forge login` there. No CLI is needed.";

const decodeTimestamp = Schema.decodeUnknownOption(Schema.DateTimeUtcFromString);
const decodeWhoami = Schema.decodeEffect(Schema.fromJsonString(Json.ForgeGraphWhoami));

/** Reports the signed-in ForgeGraph account, and claims remotes on a configured server's git hosts. */
export const makeDiscovery = Effect.gen(function* () {
  const api = yield* ForgeGraphApi.ForgeGraphApi;
  const probe = Effect.fn("ForgeGraphDiscovery.probe")(function* () {
    const server = yield* api.server;
    const host = new URL(server).host;
    const auth = yield* api.request({ operation: "whoami", path: "/fg/whoami" }).pipe(
      Effect.flatMap(decodeWhoami),
      Effect.map((whoami) =>
        providerAuth({
          status: "authenticated",
          host,
          ...(whoami.user ? { account: whoami.user } : {}),
        }),
      ),
      Effect.catch((error) =>
        Effect.succeed(
          providerAuth({
            status:
              error._tag === "ForgeGraphApiError" && error.reason === "unauthenticated"
                ? "unauthenticated"
                : "unknown",
            host,
            detail:
              error._tag === "ForgeGraphApiError"
                ? error.detail
                : "ForgeGraph's account could not be read.",
          }),
        ),
      ),
    );
    return {
      kind: KIND,
      label: LABEL,
      status: "available" as const,
      version: Option.none<string>(),
      installHint: INSTALL_HINT,
      detail: Option.none<string>(),
      auth,
    };
  });
  return {
    type: "managed-cli",
    kind: KIND,
    label: LABEL,
    installHint: INSTALL_HINT,
    probe: () => probe(),
    // forgegraf.com's own git hosts are recognised from the remote alone; a self-hosted server's
    // are only known from Settings, so they are claimed here.
    refineUnknownRemote: ({ context }) =>
      api.server.pipe(
        Effect.map((server) =>
          ForgeGraphHosts.parseForgeGraphRemote(context.remoteUrl, server) === null
            ? null
            : { kind: KIND, name: LABEL, baseUrl: server },
        ),
      ),
  } satisfies SourceControlManagedCliDiscoverySpec;
});

const changesetUrlPattern = /^https?:\/\/[^/]+\/changesets\/([0-9a-f-]{36})\/?(?:[?#].*)?$/iu;
const pullUrlPattern = /^https?:\/\/([^/]+)\/([^/]+\/[^/]+)\/pulls\/(\d+)\/?(?:[?#].*)?$/u;

export const make = Effect.gen(function* () {
  const lookups = yield* ForgeGraphLookups.make;
  const { api } = lookups;
  const host = yield* SourceControlHost.SourceControlHost;
  const fileSystem = yield* FileSystem.FileSystem;

  const error = (operation: string, cwd: string, detail: string, cause?: unknown) =>
    new SourceControlProviderError({
      provider: KIND,
      operation,
      cwd,
      detail,
      ...(cause === undefined ? {} : { cause }),
    });
  const fromApi = (operation: string, cwd: string) => (cause: ForgeGraphApi.ForgeGraphApiError) =>
    error(operation, cwd, cause.detail, cause);

  /** The checkout's ForgeGraph repository, or the one a call names. */
  const resolveRepository = Effect.fn("ForgeGraphSourceControlProvider.resolveRepository")(
    function* (
      operation: string,
      input: {
        readonly cwd: string;
        readonly context?: SourceControlProvider.SourceControlProviderContext;
        readonly repository?: string;
      },
    ) {
      const server = yield* api.server;
      if (input.repository !== undefined) {
        const named =
          ForgeGraphHosts.parseForgeGraphRemote(input.repository, server)?.repository ??
          ForgeGraphHosts.forgeGraphRepositoryPath(input.repository);
        if (named !== null) return named;
        return yield* error(operation, input.cwd, "A ForgeGraph repository is named owner/repo.");
      }
      const remoteUrl =
        input.context?.remoteUrl ??
        (yield* host.git.resolvePrimaryRemoteName(input.cwd).pipe(
          Effect.flatMap((remote) => host.git.readConfigValue(input.cwd, `remote.${remote}.url`)),
          Effect.mapError((cause) =>
            error(operation, input.cwd, "Could not read the ForgeGraph remote.", cause),
          ),
        ));
      const remote = remoteUrl ? ForgeGraphHosts.parseForgeGraphRemote(remoteUrl, server) : null;
      if (remote === null)
        return yield* error(operation, input.cwd, "No ForgeGraph repository remote was found.");
      return remote.repository;
    },
  );

  const toChangeRequest = (pull: Json.NumberedPull, server: string): ChangeRequest => {
    const item = Json.toChangeRequest(pull, server);
    return {
      provider: KIND,
      number: item.number,
      title: item.title,
      url: item.url,
      baseRefName: item.baseBranch,
      headRefName: item.headBranch,
      ...(pull.headSha ? { headSha: pull.headSha } : {}),
      state: item.state,
      ...(item.isDraft ? { isDraft: true } : {}),
      updatedAt: decodeTimestamp(item.updatedAt),
      // ForgeGraph pull requests always come from a branch of the same repository.
      isCrossRepository: false,
    };
  };

  const getChangeRequest = Effect.fn("ForgeGraphSourceControlProvider.getChangeRequest")(
    function* (input: {
      readonly cwd: string;
      readonly context?: SourceControlProvider.SourceControlProviderContext;
      readonly reference: string;
    }) {
      const operation = "getChangeRequest";
      const reference = input.reference.trim();
      const server = yield* api.server;
      // ForgeGraph's own page names the changeset directly.
      const changeset = changesetUrlPattern.exec(reference)?.[1];
      if (changeset !== undefined) {
        const pull = yield* lookups
          .pullById(operation, changeset)
          .pipe(Effect.mapError(fromApi(operation, input.cwd)));
        if (!Json.isNumbered(pull))
          return yield* error(
            operation,
            input.cwd,
            "This ForgeGraph pull request has no number yet, so T3 Code cannot track it.",
          );
        return toChangeRequest(pull, server);
      }
      const legacy = pullUrlPattern.exec(reference);
      const number = legacy
        ? ForgeGraphHosts.isForgeGraphGitHost(legacy[1] ?? "", server)
          ? legacy[3]
          : undefined
        : /^#?([1-9]\d*)$/u.exec(reference)?.[1];
      if (number === undefined)
        return yield* error(
          operation,
          input.cwd,
          "A ForgeGraph pull request is a number or a ForgeGraph pull request URL.",
        );
      const repository = legacy?.[2] ?? (yield* resolveRepository(operation, input));
      const pull = yield* lookups
        .pull(operation, repository, Number(number))
        .pipe(Effect.mapError(fromApi(operation, input.cwd)));
      return toChangeRequest(pull, server);
    },
  );

  return SourceControlProvider.SourceControlProvider.of({
    kind: KIND,
    repositoryNameFromRemoteUrl: (url) =>
      ForgeGraphHosts.parseForgeGraphRemote(url)?.repository ?? null,
    getChangeRequest,
    listChangeRequests: Effect.fn("ForgeGraphSourceControlProvider.listChangeRequests")(
      function* (input) {
        const operation = "listChangeRequests";
        const repository = yield* resolveRepository(operation, input);
        const branch = SourceControlProvider.sourceBranch(input);
        const server = yield* api.server;
        const details = yield* lookups
          .listByBranch(operation, repository, branch, input.state, input.limit ?? 20)
          .pipe(Effect.mapError(fromApi(operation, input.cwd)));
        return details
          .filter(Json.isNumbered)
          .filter((pull) => pull.sourceBranch === branch)
          .map((pull) => toChangeRequest(pull, server));
      },
    ),
    createChangeRequest: Effect.fn("ForgeGraphSourceControlProvider.createChangeRequest")(
      function* (input) {
        const operation = "createChangeRequest";
        const repository = yield* resolveRepository(operation, {
          ...input,
          ...(input.target?.repository ? { repository: input.target.repository } : {}),
        });
        const found = yield* lookups
          .target(operation, repository)
          .pipe(Effect.mapError(fromApi(operation, input.cwd)));
        const branch = SourceControlProvider.sourceBranch(input);
        const body = yield* fileSystem
          .readFileString(input.bodyFile)
          .pipe(
            Effect.mapError((cause) =>
              error(operation, input.cwd, "Could not read the pull request description.", cause),
            ),
          );
        // The branch is pushed before this runs; its head pins the changeset to what was pushed.
        const head = yield* host.git
          .resolveCommit({ cwd: input.cwd, revision: branch })
          .pipe(Effect.option);
        const created = yield* lookups
          .read(
            {
              operation,
              method: "POST",
              path: "/fg/prs",
              body: {
                vcsType: "git",
                changeId: branch,
                repositorySlug: found.appSlug ?? found.repository.slug,
                title: input.title,
                body,
                branch,
                base: input.target?.refName ?? input.baseRefName,
                ...(Option.isSome(head) ? { headSha: head.value.commitSha } : {}),
              },
            },
            Json.ForgeGraphCreated,
          )
          .pipe(Effect.mapError(fromApi(operation, input.cwd)));
        // A native repository opens no git-server pull request: the changeset is the pull request.
        const outcome = created.pullRequest;
        if (
          outcome !== undefined &&
          !outcome.opened &&
          outcome.reason !== "native_pr_backend" &&
          outcome.reason !== "changeset_settled" &&
          outcome.error
        )
          return yield* error(operation, input.cwd, outcome.error);
      },
    ),
    getRepositoryCloneUrls: Effect.fn("ForgeGraphSourceControlProvider.getRepositoryCloneUrls")(
      function* (input) {
        const operation = "getRepositoryCloneUrls";
        const repository = yield* resolveRepository(operation, input);
        const found = yield* lookups
          .target(operation, repository)
          .pipe(Effect.mapError(fromApi(operation, input.cwd)));
        const nameWithOwner = `${found.repository.owner}/${found.repository.repoName}`;
        const [gitHost = "git.forgegraf.com"] = ForgeGraphHosts.forgeGraphGitHosts(
          yield* api.server,
        );
        const https = found.repository.cloneUrl ?? `https://${gitHost}/${nameWithOwner}.git`;
        return {
          nameWithOwner,
          url: https,
          // Artifacts storage is only served by the gateway; its Forgejo SSH remote is stale.
          sshUrl:
            found.repository.storageBackend === "artifacts"
              ? https
              : `git@${gitHost}:${nameWithOwner}.git`,
        };
      },
    ),
    createRepository: (input) =>
      Effect.fail(
        error(
          "createRepository",
          input.cwd,
          "Create ForgeGraph repositories with `forge app create`; T3 Code cannot create them.",
        ),
      ),
    getDefaultBranch: Effect.fn("ForgeGraphSourceControlProvider.getDefaultBranch")(
      function* (input) {
        const operation = "getDefaultBranch";
        const repository = yield* resolveRepository(operation, input);
        const found = yield* lookups
          .target(operation, repository)
          .pipe(Effect.mapError(fromApi(operation, input.cwd)));
        return found.repository.defaultBranch ?? null;
      },
    ),
    // A ForgeGraph pull request is a branch of the repository itself, so checking one out is
    // fetching that branch from the checkout's ForgeGraph remote.
    checkoutChangeRequest: Effect.fn("ForgeGraphSourceControlProvider.checkoutChangeRequest")(
      function* (input) {
        const operation = "checkoutChangeRequest";
        const pull = yield* getChangeRequest(input);
        const server = yield* api.server;
        const git = host.git;
        // Where ForgeGraph says to fetch from; absent on a server that predates `cloneUrl`.
        const cloneUrl = yield* resolveRepository(operation, input).pipe(
          Effect.flatMap((repository) => lookups.target(operation, repository)),
          Effect.map((found) => found.repository.cloneUrl ?? null),
          Effect.orElseSucceed(() => null),
        );
        yield* Effect.gen(function* () {
          const primary = input.context
            ? { name: input.context.remoteName, url: input.context.remoteUrl }
            : yield* git
                .resolvePrimaryRemoteName(input.cwd)
                .pipe(
                  Effect.flatMap((name) =>
                    git
                      .readConfigValue(input.cwd, `remote.${name}.url`)
                      .pipe(Effect.map((url) => ({ name, url: url ?? "" }))),
                  ),
                );
          const primaryHost = ForgeGraphHosts.parseForgeGraphRemote(primary.url, server)?.gitHost;
          const cloneHost = cloneUrl
            ? ForgeGraphHosts.parseForgeGraphRemote(cloneUrl, server)?.gitHost
            : undefined;
          // The checkout's own remote serves when it reaches the host ForgeGraph names, which keeps
          // its SSH or credential setup; otherwise the branch is fetched from ForgeGraph's URL,
          // which is how an Artifacts repository is never read from Forgejo.
          const remoteName =
            cloneUrl === null || (primaryHost !== undefined && primaryHost === cloneHost)
              ? primary.name
              : yield* git.ensureRemote({
                  cwd: input.cwd,
                  preferredName: "forgegraph",
                  url: cloneUrl,
                });
          const remoteBranch = { cwd: input.cwd, remoteName, remoteBranch: pull.headRefName };
          const branches = yield* git.listLocalBranchNames(input.cwd);
          if (input.force !== true && !branches.includes(pull.headRefName))
            yield* git.fetchRemoteBranch({ ...remoteBranch, localBranch: pull.headRefName });
          else yield* git.fetchRemoteTrackingBranch(remoteBranch);
          // `checkout -B` moves even the checked-out branch, and refuses to overwrite local edits.
          if (input.force === true)
            yield* git.execute({
              operation: "ForgeGraphSourceControlProvider.checkoutChangeRequest",
              cwd: input.cwd,
              args: [
                "checkout",
                "-B",
                pull.headRefName,
                `refs/remotes/${remoteName}/${pull.headRefName}`,
                "--",
              ],
            });
          yield* git.setBranchUpstream({ ...remoteBranch, branch: pull.headRefName });
          yield* Effect.scoped(git.switchRef({ cwd: input.cwd, refName: pull.headRefName }));
        }).pipe(
          Effect.mapError((cause) =>
            error(operation, input.cwd, "Could not check out the ForgeGraph pull request.", cause),
          ),
        );
      },
    ),
  });
});
