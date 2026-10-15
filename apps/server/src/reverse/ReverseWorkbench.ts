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
  type ReverseToolchainResult,
  type ReverseCapture,
  type ReverseSerialChunk,
  type ReverseSerialObserveInput,
  type ReverseSerialOpenInput,
  type ReverseSerialPortsInput,
  type ReverseSerialPortsResult,
  type ReverseSerialRecentInput,
  type ReverseSerialRecentResult,
  type ReverseSerialSession,
  type ReverseSerialSessionInput,
  type ReverseSerialWriteInput,
  type ReverseCaptureDecodeInput,
  type ReverseCaptureDecodeResult,
  type ReverseCaptureDeleteInput,
  type ReverseCaptureImportInput,
  type ReverseCaptureViewInput,
  type ReverseCaptureViewResult,
  type ReverseFindingCreateInput,
  type ReverseImportExtractedInput,
  type ReverseDiffInput,
  type ReverseFindingPublishInput,
  type VeritasReQueryInput,
  type VeritasReQueryResult,
  type ReverseDiffResult,
  type ReverseFindingRecord,
  type ReverseFindingUpdateInput,
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
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as ServerConfig from "../config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { ReverseAnalysisService } from "./AnalysisService.ts";
import { ghidraSessions } from "./GhidraSession.ts";
import { getReverseInvestigationStore } from "./InvestigationStore.ts";
import { inspectToolchain } from "./Toolchain.ts";
import { SerialConsole } from "./SerialConsole.ts";
import { captureWindow, decodeI2c, decodeSpi, decodeUart } from "./CaptureDecode.ts";
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
    ) => Effect.Effect<ReverseInvestigation, ReverseStoreError>;
    readonly toolchain: Effect.Effect<ReverseToolchainResult, ReverseStoreError>;
    readonly serialPorts: (
      input: typeof ReverseSerialPortsInput.Type,
    ) => Effect.Effect<typeof ReverseSerialPortsResult.Type, ReverseStoreError>;
    readonly openSerial: (
      input: typeof ReverseSerialOpenInput.Type,
    ) => Effect.Effect<ReverseSerialSession, ReverseStoreError>;
    readonly writeSerial: (
      input: typeof ReverseSerialWriteInput.Type,
    ) => Effect.Effect<void, ReverseStoreError>;
    readonly closeSerial: (
      input: typeof ReverseSerialSessionInput.Type,
    ) => Effect.Effect<void, ReverseStoreError>;
    readonly serialRecent: (
      input: typeof ReverseSerialRecentInput.Type,
    ) => Effect.Effect<typeof ReverseSerialRecentResult.Type, ReverseStoreError>;
    /** Buffered output after `afterSeq`, then live output until the session closes. */
    readonly serialOutput: (
      input: typeof ReverseSerialObserveInput.Type,
    ) => Stream.Stream<ReverseSerialChunk, ReverseStoreError>;
    readonly importCapture: (
      input: typeof ReverseCaptureImportInput.Type,
    ) => Effect.Effect<ReverseCapture, ReverseStoreError>;
    readonly viewCapture: (
      input: typeof ReverseCaptureViewInput.Type,
    ) => Effect.Effect<ReverseCaptureViewResult, ReverseStoreError>;
    readonly decodeCapture: (
      input: typeof ReverseCaptureDecodeInput.Type,
    ) => Effect.Effect<ReverseCaptureDecodeResult, ReverseStoreError>;
    readonly removeCapture: (
      input: typeof ReverseCaptureDeleteInput.Type,
    ) => Effect.Effect<void, ReverseStoreError>;
    /** Publishing leaves this environment, so only people do it; it is not an agent tool. */
    /** A read-only Veritas RE query on the environment's token, for agents and future views. */
    readonly veritasQuery: (
      input: typeof VeritasReQueryInput.Type,
    ) => Effect.Effect<typeof VeritasReQueryResult.Type, ReverseStoreError>;
    readonly publishFinding: (
      input: typeof ReverseFindingPublishInput.Type,
    ) => Effect.Effect<ReverseFindingRecord, ReverseStoreError>;
    readonly diff: (
      input: typeof ReverseDiffInput.Type,
    ) => Effect.Effect<ReverseDiffResult, ReverseStoreError>;
    readonly importExtracted: (
      input: typeof ReverseImportExtractedInput.Type,
    ) => Effect.Effect<typeof ReverseImportResult.Type, ReverseStoreError>;
    /** The author comes from the transport: people in the workspace, agents through MCP. */
    readonly createFinding: (
      input: typeof ReverseFindingCreateInput.Type,
      author: "human" | "agent",
    ) => Effect.Effect<ReverseFindingRecord, ReverseStoreError>;
    readonly updateFinding: (
      input: typeof ReverseFindingUpdateInput.Type,
      actor: "human" | "agent",
    ) => Effect.Effect<ReverseFindingRecord, ReverseStoreError>;
    readonly remove: (
      input: typeof ReverseDeleteInput.Type,
    ) => Effect.Effect<void, ReverseStoreError>;
    readonly strings: (
      input: typeof ReverseStringsInput.Type,
    ) => Effect.Effect<typeof ReverseStringsResult.Type, ReverseStoreError>;
    readonly analyze: (
      input: ReverseAnalysisInput,
    ) => Effect.Effect<ReverseAnalysisResult, ReverseStoreError>;
    readonly emulate: (
      input: typeof ReverseEmulateInput.Type,
    ) => Effect.Effect<ReverseEmulateResult, ReverseStoreError>;
    readonly publish: (
      input: typeof ReversePublishInput.Type,
    ) => Effect.Effect<typeof ReversePublishResult.Type, ReverseStoreError>;
    /** The workbench protocol served over HTTP; hardware lab operations report unavailable. */
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

const veritasUnavailable = () =>
  new ReverseStoreError({
    reason: "unavailable",
    message: "Set VERITAS_URL and VERITAS_API_TOKEN on this T3 environment.",
  });

const GHIDRA_ACTIONS = {
  open: "list",
  functions: "list",
  decompile: "function",
  disassemble: "function",
  references: "function",
  graph: "function",
  rename: "rename",
  comment: "comment",
  save: "save",
  close: "close",
} as const;

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const projects = yield* ProjectService.ProjectService;
  const serverEnvironment = yield* ServerEnvironment.ServerEnvironment;
  const veritasUrl = yield* Config.String("VERITAS_URL").pipe(Config.withDefault(""));
  const veritasToken = yield* Config.String("VERITAS_API_TOKEN").pipe(Config.withDefault(""));
  const store = getReverseInvestigationStore(config.stateDir);
  const analysis = new ReverseAnalysisService(config.stateDir, store);
  const veritas = new VeritasEvidenceClient(
    veritasUrl && veritasToken ? { url: veritasUrl, token: veritasToken } : null,
  );
  const workbench = new WorkbenchService(store, veritas);
  const serial = new SerialConsole(config.stateDir, yield* HostProcess.Platform);
  // Ghidra JVMs and in-flight imports end with the server.
  yield* Effect.addFinalizer(() =>
    Effect.promise(() => workbench.close()).pipe(
      Effect.ensuring(Effect.sync(() => ghidraSessions(config.stateDir).dispose())),
      Effect.ensuring(Effect.sync(() => serial.dispose())),
    ),
  );

  // The HTTP protocol names the same analyzers the RPCs use; translate and reply in its envelope.
  const executeWorkbench = async (
    request: ReverseWorkbenchRequest,
  ): Promise<ReverseWorkbenchReply> => {
    const scope = { projectId: request.projectId, investigationId: request.investigationId };
    const reply = async (data: unknown): Promise<ReverseWorkbenchReply> => ({
      protocolVersion: 1,
      operation: request.operation,
      artifactSha256: (await store.getArtifact(scope.projectId, scope.investigationId)).artifact
        .sha256,
      data,
    });
    switch (request.operation) {
      case "scan":
        if (request.engine === "strings")
          return reply(
            await store.strings(scope.projectId, scope.investigationId, request.minLength),
          );
        return reply(
          await analysis.run({
            ...scope,
            kind: request.engine,
            // x86_64 is x86 in 64-bit mode for the gadget search.
            rawArch: request.architecture === "x86_64" ? "x86" : request.architecture,
            rawMode: request.architecture === "x86_64" ? "64" : request.mode,
            rawEndian: request.endian,
          }),
        );
      case "analysis":
        return reply(
          await analysis.run({
            ...scope,
            kind: "ghidra",
            ghidra: {
              action: GHIDRA_ACTIONS[request.action],
              address: request.address,
              languageId: request.language,
              imageBase: request.imageBase,
              name: request.name,
              expectedName: request.expectedName,
              comment: request.comment,
              cursor: request.offset,
            },
          }),
        );
      case "emulate":
        return reply(await analysis.emulate({ ...scope, machine: request.machine }));
      case "publish":
        if (!workbench.veritasConfigured) throw veritasUnavailable();
        return workbench.execute(request);
      default:
        return workbench.execute(request);
    }
  };

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
    toolchain: attempt(() => inspectToolchain()),
    serialPorts: (input) =>
      inProject(input.projectId, async () => ({
        ports: await serial.ports(),
        sessions: serial.list(input.projectId),
      })),
    openSerial: (input) =>
      inProject(input.projectId, () => serial.open(input.projectId, input.port, input.baud)),
    writeSerial: (input) =>
      inProject(input.projectId, () =>
        serial.write(input.projectId, input.sessionId, Buffer.from(input.data, "base64")),
      ),
    closeSerial: (input) =>
      inProject(input.projectId, async () => serial.closeFor(input.projectId, input.sessionId)),
    serialRecent: (input) =>
      inProject(input.projectId, async () =>
        serial.recent(input.projectId, input.sessionId, input.maxBytes ?? 8192),
      ),
    serialOutput: (input) =>
      Stream.callback<ReverseSerialChunk, ReverseStoreError>((queue) =>
        requireProject(input.projectId).pipe(
          Effect.andThen(
            Effect.acquireRelease(
              Effect.try({
                try: () =>
                  serial.observe(input.projectId, input.sessionId, input.afterSeq ?? 0, (chunk) =>
                    Queue.offerUnsafe(queue, chunk),
                  ),
                catch: (cause) =>
                  isReverseStoreError(cause)
                    ? cause
                    : new ReverseStoreError({
                        reason: "operation_failed",
                        message: "The serial session could not be observed.",
                      }),
              }),
              (stop) => Effect.sync(stop),
            ),
          ),
          Effect.catch((error) => Queue.fail(queue, error)),
        ),
      ),
    importCapture: (input) =>
      Effect.gen(function* () {
        const project = yield* requireProject(input.projectId);
        return yield* attempt(() =>
          store.importCapture({
            projectId: input.projectId,
            workspaceRoot: project.workspaceRoot,
            relativePath: input.relativePath,
          }),
        );
      }),
    viewCapture: (input) =>
      inProject(input.projectId, async () => {
        if (input.endNs <= input.startNs)
          throw new ReverseStoreError({
            reason: "invalid_file",
            message: "The window must end after it starts.",
          });
        const capture = await store.capture(input.projectId, input.captureId);
        return captureWindow(capture, input.startNs, input.endNs, input.maxPoints, input.channels);
      }),
    decodeCapture: (input) =>
      inProject(input.projectId, async () => {
        const capture = await store.capture(input.projectId, input.captureId);
        const limit = input.limit ?? 1000;
        // One extra event says whether the range had more than the limit.
        const range = {
          fromNs: input.startNs ?? 0,
          toNs: input.endNs ?? Infinity,
          limit: limit + 1,
        };
        const decoder = input.decoder;
        let events;
        try {
          events =
            decoder.protocol === "uart"
              ? decodeUart(capture, decoder.signal, decoder, range)
              : decoder.protocol === "spi"
                ? decodeSpi(capture, decoder, range)
                : decodeI2c(capture, decoder, range);
        } catch (cause) {
          // Decoder errors describe the request, such as a channel name that does not exist.
          throw new ReverseStoreError({
            reason: "invalid_file",
            message: cause instanceof Error ? cause.message : "The decoder could not run.",
          });
        }
        return { events: events.slice(0, limit), truncated: events.length > limit };
      }),
    removeCapture: (input) =>
      inProject(input.projectId, () => store.removeCapture(input.projectId, input.captureId)),
    veritasQuery: (input) =>
      veritas.configured
        ? attempt(async () => ({ result: await veritas.query(input.procedure, input.input ?? {}) }))
        : Effect.fail(veritasUnavailable()),
    publishFinding: (input) =>
      workbench.veritasConfigured
        ? inProject(input.projectId, async () => {
            await workbench.publishFinding(input.projectId, input.findingId);
            return store.finding(input.projectId, input.findingId);
          })
        : Effect.fail(veritasUnavailable()),
    diff: (input) =>
      inProject(input.projectId, () =>
        analysis.diff(input.projectId, input.leftInvestigationId, input.rightInvestigationId),
      ),
    importExtracted: (input) =>
      Effect.gen(function* () {
        yield* requireProject(input.projectId);
        const environmentId = yield* serverEnvironment.getEnvironmentId;
        return yield* attempt(async () => {
          const parent = await store.getArtifact(input.projectId, input.investigationId);
          const root = await analysis.extractedRoot(
            input.projectId,
            input.receiptId,
            parent.artifact.sha256,
          );
          // Same containment and size checks as a workspace import, rooted at the extraction.
          return store.importFile({
            projectId: input.projectId,
            workspaceRoot: root,
            relativePath: input.path,
            environmentId,
            origin: {
              parentInvestigationId: input.investigationId,
              parentSha256: parent.artifact.sha256,
              label: `${parent.artifact.filename} → ${input.path}`,
            },
          });
        });
      }),
    createFinding: (input, author) =>
      inProject(input.projectId, () => store.createFinding({ ...input, authorKind: author })),
    updateFinding: (input, actor) =>
      inProject(input.projectId, () => store.updateFinding({ ...input, actor })),
    remove: (input) =>
      inProject(input.projectId, () => store.remove(input.projectId, input.investigationId)),
    strings: (input) =>
      inProject(input.projectId, () =>
        store.strings(input.projectId, input.investigationId, input.minLength),
      ),
    analyze: (input) =>
      inProject(input.projectId, async () => {
        const result = await analysis.run(input);
        // A raw image's load settings are part of the investigation once they work.
        const profile = input.kind === "ghidra" ? input.ghidra : undefined;
        if (profile?.languageId || profile?.imageBase)
          await store.rememberGhidraProfile(input.projectId, input.investigationId, profile);
        return result;
      }),
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
        : Effect.fail(veritasUnavailable()),
    execute: (request) => inProject(request.projectId, () => executeWorkbench(request)),
  });
});

export const layer = Layer.effect(ReverseWorkbench, make);
