// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
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
      // Nothing is linked here, so registration leaves any Veritas link alone.
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
  it("publishes a finding after its firmware, recording the QEMU runs it cites first", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-publish-"));
    try {
      const workspace = NodePath.join(root, "workspace");
      await NodeFSP.mkdir(workspace);
      await NodeFSP.writeFile(NodePath.join(workspace, "fw.bin"), "firmware");
      const state = NodePath.join(root, "state");
      const store = new ReverseInvestigationStore(state);
      const { investigation, artifact } = await store.importFile({
        projectId: "p",
        environmentId: "e",
        workspaceRoot: workspace,
        relativePath: "fw.bin",
      });
      // A QEMU receipt as AnalysisService.emulate leaves it.
      const runId = NodeCrypto.randomUUID();
      const owner = NodeCrypto.createHash("sha256").update("p").digest("hex");
      const receipt = NodePath.join(state, "reverse", "emulation", owner, runId);
      await NodeFSP.mkdir(receipt, { recursive: true });
      await NodeFSP.writeFile(
        NodePath.join(receipt, "receipt.json"),
        JSON.stringify({ artifactSha256: artifact.sha256, outcome: "inconclusive" }),
      );
      const finding = await store.createFinding({
        projectId: "p",
        investigationId: investigation.id,
        title: "Boot loops on bad header",
        kind: "boot-chain",
        authorKind: "human",
        evidence: [{ kind: "execution", source: "qemu", runId, artifactSha256: artifact.sha256 }],
      });

      const procedures: string[] = [];
      const client = new VeritasEvidenceClient(
        { url: "https://veritas.example", token: "server-secret" },
        async (url) => {
          const procedure = String(url).split("/").pop()!;
          procedures.push(procedure);
          const json =
            procedure === "reFirmware.recordExperiment"
              ? { experiment: { runId } }
              : procedure === "reFirmware.createFinding"
                ? { finding: { id: "vf1" } }
                : {
                    artifact: {
                      id: "va1",
                      sha256: artifact.sha256,
                      sizeBytes: String(artifact.sizeBytes),
                    },
                  };
          return Response.json({ result: { data: { json } } });
        },
      );
      const service = new WorkbenchService(store, client);

      await expect(service.publishFinding("p", finding.id)).rejects.toMatchObject({
        reason: "unavailable",
      });
      await service.publish("p", investigation.id);
      expect(await service.publishFinding("p", finding.id)).toEqual({ id: "vf1" });
      expect(await service.publishFinding("p", finding.id)).toEqual({ id: "vf1" });
      expect(procedures).toEqual([
        "reFirmware.register",
        "reFirmware.recordExperiment",
        "reFirmware.createFinding",
      ]);
      expect((await store.finding("p", finding.id)).veritasFindingId).toBe("vf1");
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });

  it("passes Veritas's own explanation through to the user", async () => {
    const client = new VeritasEvidenceClient(
      { url: "https://veritas.example", token: "secret" },
      async () =>
        Response.json(
          {
            error: {
              json: {
                message:
                  "Digest already registered with different provenance: source is vendor, not imported.",
              },
            },
          },
          { status: 409 },
        ),
    );
    await expect(
      client.register({
        sha256: "a".repeat(64),
        sizeBytes: 1,
        filename: "a.bin",
        sourcePath: "a.bin",
        importedAt: "2026-10-15",
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining("source is vendor, not imported") });
  });
  it("reads Veritas data with a GET query that carries its input in the URL", async () => {
    const seen: Array<{ method: string | undefined; url: string; body: unknown }> = [];
    const client = new VeritasEvidenceClient(
      { url: "https://veritas.example", token: "secret" },
      async (url, init) => {
        seen.push({ method: init?.method, url: String(url), body: init?.body });
        return Response.json({ result: { data: { json: { frames: [] } } } });
      },
    );
    expect(await client.query("reBoards.get", { boardId: "b1" })).toEqual({ frames: [] });
    const request = new URL(seen[0]!.url);
    expect(seen[0]).toMatchObject({ method: "GET", body: undefined });
    expect(request.pathname).toBe("/api/trpc/reBoards.get");
    expect(JSON.parse(request.searchParams.get("input")!)).toEqual({ json: { boardId: "b1" } });
  });
  it("changes a shared Veritas board link only when the user changed theirs", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-board-"));
    try {
      const workspace = NodePath.join(root, "workspace");
      await NodeFSP.mkdir(workspace);
      await NodeFSP.writeFile(NodePath.join(workspace, "fw.bin"), "board firmware");
      const store = new ReverseInvestigationStore(NodePath.join(root, "state"));
      const { investigation, artifact } = await store.importFile({
        projectId: "p",
        environmentId: "e",
        workspaceRoot: workspace,
        relativePath: "fw.bin",
      });
      const calls: Array<{ procedure: string; body: unknown }> = [];
      const client = new VeritasEvidenceClient(
        { url: "https://veritas.example", token: "secret" },
        async (url, init) => {
          const procedure = String(url).split("/").pop()!;
          calls.push({ procedure, body: JSON.parse(String(init?.body)).json });
          return Response.json({
            result: {
              data: {
                json: {
                  artifact: {
                    id: "va1",
                    sha256: artifact.sha256,
                    sizeBytes: String(artifact.sizeBytes),
                  },
                },
              },
            },
          });
        },
      );
      const service = new WorkbenchService(store, client);

      await store.link("p", investigation.id, { boardRevisionId: "br1" });
      await service.publish("p", investigation.id);
      await service.publish("p", investigation.id);
      await store.link("p", investigation.id, { boardRevisionId: null });
      await service.publish("p", investigation.id);

      expect(calls.map((call) => call.procedure)).toEqual([
        "reFirmware.register",
        "reFirmware.register",
        "reFirmware.register",
        "reFirmware.linkBoardRevision",
      ]);
      // The saved board fills an empty link; clearing it here clears it there.
      expect(calls[0]!.body).toMatchObject({ boardRevisionId: "br1" });
      expect(calls[3]!.body).toEqual({ sha256: artifact.sha256, boardRevisionId: null });
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });
});
