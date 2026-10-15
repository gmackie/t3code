// @effect-diagnostics nodeBuiltinImport:off
import * as Fs from "node:fs/promises";
import type { ReverseFirmwareArtifact } from "@t3tools/contracts";
import type { ReverseWorkbenchRequest, ReverseWorkbenchReply } from "@t3tools/contracts/reverseWorkbench";
import { ReverseInvestigationStore } from "./InvestigationStore.ts";
import { VeritasEvidenceClient } from "./VeritasEvidenceClient.ts";

export interface WorkbenchArtifact { artifact: ReverseFirmwareArtifact; path: string }
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
  constructor(store: ReverseInvestigationStore, veritas: VeritasEvidenceClient, extensions: readonly WorkbenchExtension[] = []) {
    this.store = store;
    this.veritas = veritas;
    this.extensions = extensions;
  }
  async execute(request: ReverseWorkbenchRequest): Promise<ReverseWorkbenchReply> {
    const source = await this.store.getArtifact(request.projectId, request.investigationId);
    let data: unknown;
    if (request.operation === "status") {
      data = { veritasConfigured: this.veritas.configured, operations: ["status", "bytes", "publish", ...this.extensions.flatMap(x => x.operations)], extensions: this.extensions.map(x => x.status()) };
    } else if (request.operation === "bytes") {
      if (request.offset > source.artifact.sizeBytes) throw new Error("Byte offset is outside the artifact.");
      const handle = await Fs.open(source.path, "r");
      try {
        const buffer = Buffer.alloc(Math.min(request.length, source.artifact.sizeBytes - request.offset));
        const read = await handle.read(buffer, 0, buffer.length, request.offset);
        data = { offset: request.offset, hex: buffer.subarray(0, read.bytesRead).toString("hex"), sizeBytes: source.artifact.sizeBytes, addressKind: "file-offset" };
      } finally { await handle.close(); }
    } else if (request.operation === "publish") {
      const current = (await this.store.list(request.projectId)).investigations.find(x => x.id === request.investigationId);
      data = await this.veritas.register(source.artifact, current?.boardRevisionId);
    } else {
      const extension = this.extensions.find(x => x.operations.includes(request.operation));
      if (!extension) throw new Error(`Operation ${request.operation} is unavailable on this environment. Install or enable the matching backend.`);
      data = await extension.execute(request, source);
    }
    return { protocolVersion: 1, operation: request.operation, artifactSha256: source.artifact.sha256, data };
  }
  async close(): Promise<void> { await Promise.all(this.extensions.map(x => x.close())); }
}
