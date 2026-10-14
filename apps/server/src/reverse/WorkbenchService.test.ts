// @effect-diagnostics nodeBuiltinImport:off
import * as Fs from "node:fs/promises";
import * as Os from "node:os";
import * as Path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { ReverseInvestigationStore } from "./InvestigationStore.ts";
import { VeritasEvidenceClient } from "./VeritasEvidenceClient.ts";
import { WorkbenchService } from "./WorkbenchService.ts";

describe("Reverse workbench service", () => {
  it("reads bounded bytes, preserves project isolation, and publishes matching immutable identity", async () => {
    const root = await Fs.mkdtemp(Path.join(Os.tmpdir(), "t3-workbench-"));
    try {
      const workspace = Path.join(root, "workspace"); await Fs.mkdir(workspace);
      await Fs.writeFile(Path.join(workspace, "firmware.bin"), Buffer.from([0, 1, 2, 255]));
      const store = new ReverseInvestigationStore(Path.join(root, "state"));
      const imported = await store.importFile({ projectId: "p", environmentId: "e", workspaceRoot: workspace, relativePath: "firmware.bin" });
      const calls: unknown[] = [];
      const client = new VeritasEvidenceClient({ url: "https://veritas.example", token: "server-secret" }, async (_url, init) => {
        calls.push(JSON.parse(String(init?.body)));
        return Response.json({ result: { data: { json: { artifact: { id: "registered", sha256: imported.artifact.sha256, sizeBytes: "4" } } } } });
      });
      const service = new WorkbenchService(store, client);
      const scope = { projectId: "p", investigationId: imported.investigation.id };
      expect((await service.execute({ ...scope, operation: "bytes", offset: 2, length: 4 })).data).toMatchObject({ hex: "02ff", addressKind: "file-offset" });
      await expect(service.execute({ ...scope, projectId: "other", operation: "bytes", offset: 0, length: 4 })).rejects.toThrow();
      expect((await service.execute({ ...scope, operation: "publish" })).data).toMatchObject({ id: "registered" });
      expect(calls).toEqual([{ json: { identity: { sha256: imported.artifact.sha256, sizeBytes: "4", source: "imported" } } }]);
      await expect(service.execute({ ...scope, operation: "scan", engine: "gadgets" })).rejects.toThrow("unavailable");
    } finally { await Fs.rm(root, { recursive: true, force: true }); }
  });
  it("rejects mismatched publication acknowledgements", async () => {
    const client = new VeritasEvidenceClient({ url: "https://veritas.example", token: "secret" }, async () => Response.json({ result: { data: { json: { artifact: { id: "wrong", sha256: "b".repeat(64), sizeBytes: "1" } } } } }));
    await expect(client.register({ sha256: "a".repeat(64), sizeBytes: 1, filename: "a.bin", sourcePath: "a.bin", importedAt: "2026-10-13" })).rejects.toThrow("mismatched");
  });
});
