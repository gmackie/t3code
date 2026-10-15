// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import {
  type ReverseFirmwareArtifact,
  type ReverseFirmwareSource,
  ReverseStoreError,
} from "@t3tools/contracts";
import type {
  ReverseWorkbenchRequest,
  ReverseWorkbenchReply,
} from "@t3tools/contracts/reverseWorkbench";
import { ReverseInvestigationStore } from "./InvestigationStore.ts";
import { VeritasEvidenceClient } from "./VeritasEvidenceClient.ts";

export interface WorkbenchArtifact {
  artifact: ReverseFirmwareArtifact;
  path: string;
}
export interface WorkbenchExtension {
  readonly operations: readonly string[];
  status(): Record<string, unknown>;
  execute(request: ReverseWorkbenchRequest, source: WorkbenchArtifact): Promise<unknown>;
  close(): Promise<void>;
}

/** Every path is resolved by project membership; callers never supply host paths to tool adapters. */
export class WorkbenchService {
  private readonly store: ReverseInvestigationStore;
  private readonly veritas: VeritasEvidenceClient;
  private readonly extensions: readonly WorkbenchExtension[];
  constructor(
    store: ReverseInvestigationStore,
    veritas: VeritasEvidenceClient,
    extensions: readonly WorkbenchExtension[] = [],
  ) {
    this.store = store;
    this.veritas = veritas;
    this.extensions = extensions;
  }
  async execute(request: ReverseWorkbenchRequest): Promise<ReverseWorkbenchReply> {
    const source = await this.store.getArtifact(request.projectId, request.investigationId);
    let data: unknown;
    if (request.operation === "status") {
      data = {
        veritasConfigured: this.veritas.configured,
        operations: [
          "status",
          "bytes",
          "publish",
          "scan",
          "analysis",
          "emulate",
          ...this.extensions.flatMap((x) => x.operations),
        ],
        extensions: this.extensions.map((x) => x.status()),
      };
    } else if (request.operation === "bytes") {
      if (request.offset > source.artifact.sizeBytes)
        throw new Error("Byte offset is outside the artifact.");
      const handle = await NodeFSP.open(source.path, "r");
      try {
        const buffer = Buffer.alloc(
          Math.min(request.length, source.artifact.sizeBytes - request.offset),
        );
        const read = await handle.read(buffer, 0, buffer.length, request.offset);
        data = {
          offset: request.offset,
          hex: buffer.subarray(0, read.bytesRead).toString("hex"),
          sizeBytes: source.artifact.sizeBytes,
          addressKind: "file-offset",
        };
      } finally {
        await handle.close();
      }
    } else if (request.operation === "publish") {
      data = await this.publish(request.projectId, request.investigationId, request.source);
    } else {
      const extension = this.extensions.find((x) => x.operations.includes(request.operation));
      if (!extension)
        throw new Error(
          `Operation ${request.operation} is unavailable on this environment. Install or enable the matching backend.`,
        );
      data = await extension.execute(request, source);
    }
    return {
      protocolVersion: 1,
      operation: request.operation,
      artifactSha256: source.artifact.sha256,
      data,
    };
  }
  /** The board revision comes from the saved linkage, never from the caller. */
  async publish(
    projectId: string,
    investigationId: string,
    source: ReverseFirmwareSource = "imported",
  ): Promise<{ id: string; sha256: string }> {
    const { artifact } = await this.store.getArtifact(projectId, investigationId);
    const linked = (await this.store.list(projectId)).investigations.find(
      (item) => item.id === investigationId,
    );
    const saved = linked?.boardRevisionId ?? null;
    // Veritas artifacts are shared across the organization, so a board link someone else set is
    // only changed when this user changed theirs since the last sync, never just because none
    // is saved here.
    const changed =
      linked?.veritasBoardRevisionId !== undefined && saved !== linked.veritasBoardRevisionId;
    // Registration validates the board and only fills an empty link.
    const registered = await this.veritas.register(
      artifact,
      changed ? undefined : (saved ?? undefined),
      source,
    );
    if (changed) {
      try {
        await this.veritas.linkBoardRevision(artifact.sha256, saved);
      } catch (cause) {
        // Registered either way; keep the previous board as the last synced one.
        await this.store.markRegistered(
          projectId,
          investigationId,
          registered.id,
          linked?.veritasBoardRevisionId ?? null,
        );
        throw new ReverseStoreError({
          reason: "operation_failed",
          message: `Registered in Veritas, but the board revision was not updated: ${
            cause instanceof Error ? cause.message : "unknown error"
          }`,
        });
      }
    }
    await this.store.markRegistered(projectId, investigationId, registered.id, saved);
    return registered;
  }

  /**
   * Publishes a finding as a Veritas candidate. The firmware must be registered first, and each
   * QEMU run the finding cites is recorded before the finding so its evidence resolves.
   */
  publishFinding(projectId: string, findingId: string): Promise<{ id: string }> {
    // Concurrent clicks share one publication; Veritas also deduplicates by the T3 finding id.
    const key = `${projectId}:${findingId}`;
    const running = this.publishing.get(key);
    if (running) return running;
    const publication = this.publishFindingOnce(projectId, findingId).finally(() =>
      this.publishing.delete(key),
    );
    this.publishing.set(key, publication);
    return publication;
  }
  private readonly publishing = new Map<string, Promise<{ id: string }>>();
  private async publishFindingOnce(projectId: string, findingId: string): Promise<{ id: string }> {
    const finding = await this.store.finding(projectId, findingId);
    if (finding.veritasFindingId) return { id: finding.veritasFindingId };
    if (finding.status === "rejected" || finding.status === "superseded")
      throw new ReverseStoreError({
        reason: "invalid_file",
        message: "Closed findings are not published; reopen it first.",
      });
    const investigation = (await this.store.list(projectId)).investigations.find(
      (item) => item.id === finding.investigationId,
    );
    if (!investigation?.veritasArtifactId)
      throw new ReverseStoreError({
        reason: "unavailable",
        message: "Register this firmware in Veritas before publishing its findings.",
      });
    if (finding.evidence.some((ref) => ref.kind === "capture"))
      throw new ReverseStoreError({
        reason: "invalid_file",
        message:
          "This finding cites a capture kept on this environment, which Veritas cannot resolve. Remove that evidence to publish it.",
      });
    for (const ref of finding.evidence) {
      if (ref.kind !== "execution") continue;
      const outcome = await this.store.emulationOutcome(
        projectId,
        ref.runId,
        finding.artifactSha256,
      );
      if (outcome === null)
        throw new ReverseStoreError({
          reason: "not_found",
          message: `QEMU run ${ref.runId} is no longer recorded on this environment.`,
        });
      await this.veritas.recordEmulation({
        artifactSha256: finding.artifactSha256,
        runId: ref.runId,
        outcome,
      });
    }
    const published = await this.veritas.createFinding(finding);
    await this.store.markFindingPublished(projectId, findingId, published.id);
    return published;
  }
  get veritasConfigured(): boolean {
    return this.veritas.configured;
  }
  async close(): Promise<void> {
    await Promise.all(this.extensions.map((x) => x.close()));
  }
}
