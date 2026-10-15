/**
 * ReverseWorkbench - firmware investigations for a project.
 *
 * Owns the investigation store, native analyzers, the Ghidra session pool and
 * the Veritas client. WebSocket RPCs and the workbench HTTP route call it; it
 * checks that the project exists before touching any investigation.
 *
 * @module ReverseWorkbench
 */
import {
  type ProjectId,
  type ReverseAnalysisInput,
  type ReverseAnalysisResult,
  type ReverseDeleteInput,
  type ReverseEmulateInput,
  type ReverseEmulateResult,
  type ReverseImportInput,
  type ReverseImportResult,
  type ReverseInvestigation,
  type ReverseLinkInput,
  type ReverseListInput,
  type ReverseListResult,
  type ReversePublishInput,
  type ReversePublishResult,
  ReverseStoreError,
  type ReverseStringsInput,
  type ReverseStringsResult,
} from "@t3tools/contracts";
import type {
  ReverseWorkbenchReply,
  ReverseWorkbenchRequest,
} from "@t3tools/contracts/reverseWorkbench";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { ReverseAnalysisService } from "./AnalysisService.ts";
import { ghidraSessions } from "./GhidraSession.ts";
import { getReverseInvestigationStore } from "./InvestigationStore.ts";
import { VeritasEvidenceClient } from "./VeritasEvidenceClient.ts";
import { WorkbenchService } from "./WorkbenchService.ts";

const isReverseStoreError = Schema.is(ReverseStoreError);

export class ReverseWorkbench extends Context.Service<
  ReverseWorkbench,
  {
    readonly list: (
      input: typeof ReverseListInput.Type,
    ) => Effect.Effect<typeof ReverseListResult.Type, ReverseStoreError>;
    readonly importFile: (
      input: typeof ReverseImportInput.Type,
    ) => Effect.Effect<typeof ReverseImportResult.Type, ReverseStoreError>;
    readonly link: (
      input: typeof ReverseLinkInput.Type,
    ) => Effect.Effect<typeof ReverseInvestigation.Type, ReverseStoreError>;
    readonly remove: (
      input: typeof ReverseDeleteInput.Type,
    ) => Effect.Effect<void, ReverseStoreError>;
    readonly strings: (
      input: typeof ReverseStringsInput.Type,
    ) => Effect.Effect<typeof ReverseStringsResult.Type, ReverseStoreError>;
    readonly analyze: (
      input: typeof ReverseAnalysisInput.Type,
    ) => Effect.Effect<typeof ReverseAnalysisResult.Type, ReverseStoreError>;
    readonly emulate: (
      input: typeof ReverseEmulateInput.Type,
    ) => Effect.Effect<typeof ReverseEmulateResult.Type, ReverseStoreError>;
    readonly publish: (
      input: typeof ReversePublishInput.Type,
    ) => Effect.Effect<typeof ReversePublishResult.Type, ReverseStoreError>;
    /** The workbench protocol served over HTTP; extension operations report unavailable. */
    readonly execute: (
      request: ReverseWorkbenchRequest,
    ) => Effect.Effect<ReverseWorkbenchReply, ReverseStoreError>;
  }
>()("t3/reverse/ReverseWorkbench") {}

// The investigation code is promise-based; its own ReverseStoreErrors pass through.
// Anything else can carry host paths, so clients get a fixed message and the log gets the cause.
const unexpected = (cause: unknown) =>
  Effect.logWarning("Reverse workbench operation failed", cause).pipe(
    Effect.andThen(
      Effect.fail(
        new ReverseStoreError({
          reason: "operation_failed",
          message: "The reverse workbench operation failed. Details are in the server log.",
        }),
      ),
    ),
  );
class UnexpectedReverseFailure extends Data.TaggedError("UnexpectedReverseFailure")<{
  readonly cause: unknown;
}> {}
const attempt = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (cause) =>
      isReverseStoreError(cause) ? cause : new UnexpectedReverseFailure({ cause }),
  }).pipe(Effect.catchTags({ UnexpectedReverseFailure: (failure) => unexpected(failure.cause) }));

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const projects = yield* ProjectService.ProjectService;
  const serverEnvironment = yield* ServerEnvironment.ServerEnvironment;
  const veritasUrl = yield* Config.String("VERITAS_URL").pipe(Config.withDefault(""));
  const veritasToken = yield* Config.String("VERITAS_API_TOKEN").pipe(Config.withDefault(""));
  const store = getReverseInvestigationStore(config.stateDir);
  const analysis = new ReverseAnalysisService(config.stateDir, store);
  const workbench = new WorkbenchService(
    store,
    new VeritasEvidenceClient(
      veritasUrl && veritasToken ? { url: veritasUrl, token: veritasToken } : null,
    ),
  );
  // Ghidra JVMs and in-flight imports end with the server.
  yield* Effect.addFinalizer(() =>
    Effect.promise(() => workbench.close()).pipe(
      Effect.ensuring(Effect.sync(() => ghidraSessions(config.stateDir).dispose())),
    ),
  );

  const requireProject = (projectId: string) =>
    projects.getById(projectId as ProjectId).pipe(
      Effect.catch(unexpected),
      Effect.flatMap(
        Option.match({
          onNone: () =>
            Effect.fail(
              new ReverseStoreError({ reason: "not_found", message: "Project not found" }),
            ),
          onSome: Effect.succeed,
        }),
      ),
    );
  const inProject = <A>(projectId: string, run: () => Promise<A>) =>
    requireProject(projectId).pipe(Effect.andThen(attempt(run)));

  return ReverseWorkbench.of({
    list: (input) => inProject(input.projectId, () => store.list(input.projectId)),
    importFile: (input) =>
      Effect.gen(function* () {
        const project = yield* requireProject(input.projectId);
        const environmentId = yield* serverEnvironment.getEnvironmentId;
        return yield* attempt(() =>
          store.importFile({
            projectId: input.projectId,
            workspaceRoot: project.workspaceRoot,
            relativePath: input.relativePath,
            environmentId,
          }),
        );
      }),
    link: (input) =>
      inProject(input.projectId, () =>
        store.link(input.projectId, input.investigationId, {
          veritasProjectId: input.veritasProjectId,
          boardRevisionId: input.boardRevisionId,
        }),
      ),
    remove: (input) =>
      inProject(input.projectId, () => store.remove(input.projectId, input.investigationId)),
    strings: (input) =>
      inProject(input.projectId, () =>
        store.strings(input.projectId, input.investigationId, input.minLength),
      ),
    analyze: (input) => inProject(input.projectId, () => analysis.run(input)),
    emulate: (input) => inProject(input.projectId, () => analysis.emulate(input)),
    publish: (input) =>
      workbench.veritasConfigured
        ? inProject(input.projectId, async () => {
            const registered = await workbench.publish(
              input.projectId,
              input.investigationId,
              input.source,
            );
            return { artifactId: registered.id, sha256: registered.sha256 };
          })
        : Effect.fail(
            new ReverseStoreError({
              reason: "unavailable",
              message: "Set VERITAS_URL and VERITAS_API_TOKEN on this T3 environment.",
            }),
          ),
    execute: (request) => inProject(request.projectId, () => workbench.execute(request)),
  });
});

export const layer = Layer.effect(ReverseWorkbench, make);
