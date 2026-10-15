// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { ReverseInvestigationStore } from "./InvestigationStore.ts";
import { VeritasEvidenceClient } from "./VeritasEvidenceClient.ts";
import { WorkbenchService } from "./WorkbenchService.ts";

describe("Reverse workbench service", () => {
  it("reads bounded bytes, preserves project isolation, and publishes matching immutable identity", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-workbench-"));
    try {
      const workspace = NodePath.join(root, "workspace");
      await NodeFSP.mkdir(workspace);
      await NodeFSP.writeFile(
        NodePath.join(workspace, "firmware.bin"),
        Buffer.from([0, 1, 2, 255]),
      );
      const store = new ReverseInvestigationStore(NodePath.join(root, "state"));
      const imported = await store.importFile({
        projectId: "p",
        environmentId: "e",
        workspaceRoot: workspace,
        relativePath: "firmware.bin",
      });
      const calls: unknown[] = [];
      const client = new VeritasEvidenceClient(
        { url: "https://veritas.example", token: "server-secret" },
        async (_url, init) => {
          calls.push(JSON.parse(String(init?.body)));
          return Response.json({
            result: {
              data: {
                json: {
                  artifact: { id: "registered", sha256: imported.artifact.sha256, sizeBytes: "4" },
                },
              },
            },
          });
        },
      );
      const service = new WorkbenchService(store, client);
      const scope = { projectId: "p", investigationId: imported.investigation.id };
      expect(
        (await service.execute({ ...scope, operation: "bytes", offset: 2, length: 4 })).data,
      ).toMatchObject({ hex: "02ff", addressKind: "file-offset" });
      await expect(
        service.execute({ ...scope, projectId: "other", operation: "bytes", offset: 0, length: 4 }),
      ).rejects.toThrow();
      expect((await service.execute({ ...scope, operation: "publish" })).data).toMatchObject({
        id: "registered",
      });
      expect(calls).toEqual([
        {
          json: {
            identity: { sha256: imported.artifact.sha256, sizeBytes: "4", source: "imported" },
          },
        },
      ]);
      await expect(
        service.execute({ ...scope, operation: "scan", engine: "gadgets" }),
      ).rejects.toThrow("unavailable");
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });
  it("rejects mismatched publication acknowledgements", async () => {
    const client = new VeritasEvidenceClient(
      { url: "https://veritas.example", token: "secret" },
      async () =>
        Response.json({
          result: {
            data: { json: { artifact: { id: "wrong", sha256: "b".repeat(64), sizeBytes: "1" } } },
          },
        }),
    );
    await expect(
      client.register({
        sha256: "a".repeat(64),
        sizeBytes: 1,
        filename: "a.bin",
        sourcePath: "a.bin",
        importedAt: "2026-10-13",
      }),
    ).rejects.toThrow("mismatched");
  });
  it("keeps the token off cleartext remote hosts and sends the chosen provenance", async () => {
    const artifact = {
      sha256: "a".repeat(64),
      sizeBytes: 1,
      filename: "a.bin",
      sourcePath: "a.bin",
      importedAt: "2026-10-13",
    };
    const bodies: unknown[] = [];
    const fetcher: typeof fetch = async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({
        result: {
          data: { json: { artifact: { id: "a1", sha256: artifact.sha256, sizeBytes: "1" } } },
        },
      });
    };
    await expect(
      new VeritasEvidenceClient(
        { url: "http://veritas.example", token: "secret" },
        fetcher,
      ).register(artifact),
    ).rejects.toThrow("HTTPS");
    expect(bodies).toEqual([]);
    await new VeritasEvidenceClient(
      { url: "http://127.0.0.1:3000", token: "secret" },
      fetcher,
    ).register(artifact, undefined, "flash-read");
    expect(bodies).toEqual([
      { json: { identity: { sha256: artifact.sha256, sizeBytes: "1", source: "flash-read" } } },
    ]);

    // Extracted firmware is registered against its parent, whatever source was chosen.
    await new VeritasEvidenceClient(
      { url: "https://veritas.example", token: "secret" },
      fetcher,
    ).register({ ...artifact, parentSha256: "c".repeat(64) }, undefined, "vendor");
    expect(bodies[1]).toEqual({
      json: {
        identity: {
          sha256: artifact.sha256,
          sizeBytes: "1",
          source: "extracted",
          parentSha256: "c".repeat(64),
        },
      },
    });
  });
});
