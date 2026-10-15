// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { ReverseInvestigationStore } from "./InvestigationStore.ts";

let directory = "";
let root = "";
let store: ReverseInvestigationStore;

beforeEach(async () => {
  directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-reverse-"));
  root = NodePath.join(directory, "workspace");
  await NodeFSP.mkdir(root, { recursive: true });
  store = new ReverseInvestigationStore(NodePath.join(directory, "state"));
});
afterEach(async () => {
  await NodeFSP.rm(directory, { recursive: true, force: true });
});

describe("reverse investigation persistence", () => {
  it("imports and hashes immutable bytes while remaining idempotent", async () => {
    await NodeFSP.writeFile(
      NodePath.join(root, "fixture.bin"),
      Buffer.from(
        "hello WORLD" + String.fromCharCode(0) + "serial=115200" + String.fromCharCode(0),
      ),
    );
    const input = {
      projectId: "p1",
      environmentId: "env1",
      workspaceRoot: root,
      relativePath: "fixture.bin",
    };
    const first = await store.importFile(input);
    const again = await store.importFile(input);
    expect(first.investigation.id).toBe(again.investigation.id);
    expect(first.artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect((await store.list("p1")).investigations).toHaveLength(1);
    expect((await store.list("p2")).investigations).toHaveLength(0);
    const recovered = new ReverseInvestigationStore(NodePath.join(directory, "state"));
    expect((await recovered.list("p1")).investigations[0]?.id).toBe(first.investigation.id);
    expect(
      (await recovered.strings("p1", first.investigation.id)).strings.map((x) => x.value),
    ).toContain("serial=115200");
  });

  it("bounds each extracted string and keeps its file offset", async () => {
    await NodeFSP.writeFile(
      NodePath.join(root, "long.bin"),
      Buffer.concat([Buffer.from([0, 0]), Buffer.from("A".repeat(2000)), Buffer.from([0])]),
    );
    const { investigation } = await store.importFile({
      projectId: "p1",
      environmentId: "env1",
      workspaceRoot: root,
      relativePath: "long.bin",
    });
    const { strings } = await store.strings("p1", investigation.id);
    expect(strings).toEqual([{ offset: 2, value: "A".repeat(512) }]);
  });

  it("refuses a named pipe instead of waiting for a writer", async () => {
    NodeChildProcess.execFileSync("mkfifo", [NodePath.join(root, "pipe.bin")]);
    await expect(
      store.importFile({
        projectId: "p1",
        environmentId: "env1",
        workspaceRoot: root,
        relativePath: "pipe.bin",
      }),
    ).rejects.toMatchObject({ reason: "invalid_file" });
  });

  it("keeps findings as hypotheses that only a person confirms", async () => {
    await NodeFSP.writeFile(NodePath.join(root, "fw.bin"), "firmware under review");
    const { investigation, artifact } = await store.importFile({
      projectId: "p1",
      environmentId: "env1",
      workspaceRoot: root,
      relativePath: "fw.bin",
    });
    const code = (artifactSha256: string) => ({
      kind: "code" as const,
      location: { artifactSha256, addressSpace: "ram", address: "0x8000", architecture: "arm" },
    });
    await expect(
      store.createFinding({
        projectId: "p1",
        investigationId: investigation.id,
        title: "Cites other firmware",
        kind: "other",
        evidence: [code("f".repeat(64))],
        authorKind: "agent",
      }),
    ).rejects.toMatchObject({ reason: "invalid_file" });

    const finding = await store.createFinding({
      projectId: "p1",
      investigationId: investigation.id,
      title: "Unchecked length in parser",
      kind: "memory-corruption",
      evidence: [code(artifact.sha256)],
      authorKind: "agent",
    });
    expect(finding).toMatchObject({ status: "candidate", authorKind: "agent" });

    const update = { projectId: "p1", findingId: finding.id };
    for (const status of ["probable", "confirmed"] as const)
      await expect(store.updateFinding({ ...update, status, actor: "agent" })).rejects.toThrow(
        "up to a person",
      );
    expect(
      await store.updateFinding({ ...update, status: "rejected", actor: "agent" }),
    ).toMatchObject({ status: "rejected", statusChangedBy: "agent" });
    expect(
      await store.updateFinding({ ...update, status: "confirmed", actor: "human" }),
    ).toMatchObject({ status: "confirmed", statusChangedBy: "human" });
    // Once a person decides, an agent cannot overturn it.
    await expect(
      store.updateFinding({ ...update, status: "superseded", actor: "agent" }),
    ).rejects.toThrow("only a person");

    const base = {
      projectId: "p1",
      investigationId: investigation.id,
      title: "x",
      kind: "other" as const,
    };
    await expect(
      store.createFinding({ ...base, evidence: [], authorKind: "agent" }),
    ).rejects.toThrow("cite evidence");
    await expect(
      store.createFinding({
        ...base,
        authorKind: "agent",
        evidence: [
          {
            kind: "execution",
            source: "qemu",
            runId: "00000000-0000-0000-0000-000000000000",
            artifactSha256: artifact.sha256,
          },
        ],
      }),
    ).rejects.toThrow("QEMU run");
    expect((await store.list("p1")).findings).toHaveLength(1);

    await store.remove("p1", investigation.id);
    expect((await store.list("p1")).findings).toHaveLength(0);
  });

  it("reads project records written before findings existed", async () => {
    const projects = NodePath.join(directory, "state", "reverse", "projects");
    await NodeFSP.mkdir(projects, { recursive: true });
    const name = NodeCrypto.createHash("sha256").update("legacy").digest("hex");
    await NodeFSP.writeFile(
      NodePath.join(projects, `${name}.json`),
      JSON.stringify({ investigations: [], artifacts: [] }),
    );
    expect((await store.list("legacy")).findings).toEqual([]);
  });

  it("imports captures, lets findings cite them, and deletes them", async () => {
    await NodeFSP.writeFile(
      NodePath.join(root, "uart.vcd"),
      "$timescale 1 us $end\n$var wire 1 ! tx $end\n$enddefinitions $end\n#0\n1!\n#4\n0!\n#10\n",
    );
    await NodeFSP.writeFile(NodePath.join(root, "fw.bin"), "firmware");
    await NodeFSP.writeFile(NodePath.join(root, "session.sal"), "not readable");
    const base = { projectId: "p1", workspaceRoot: root };
    const capture = await store.importCapture({ ...base, relativePath: "uart.vcd" });
    expect(capture).toMatchObject({ format: "vcd", channels: ["tx"], durationNs: 10_000 });
    expect(await store.importCapture({ ...base, relativePath: "uart.vcd" })).toEqual(capture);
    await expect(
      store.importCapture({ ...base, relativePath: "session.sal" }),
    ).rejects.toMatchObject({
      reason: "invalid_file",
    });
    expect((await store.list("p1")).captures).toHaveLength(1);
    expect(Array.from((await store.capture("p1", capture.id)).channels[0]!.edges)).toEqual([4000]);

    const { investigation } = await store.importFile({
      ...base,
      environmentId: "env1",
      relativePath: "fw.bin",
    });
    const cite = (captureId: string) =>
      store.createFinding({
        projectId: "p1",
        investigationId: investigation.id,
        title: "Boot banner leaks build id",
        kind: "protocol",
        authorKind: "human",
        evidence: [{ kind: "capture", captureId, signal: "tx", startNs: 0, endNs: 10_000 }],
      });
    await expect(cite("missing")).rejects.toThrow("capture in this project");
    expect((await cite(capture.id)).evidence[0]).toMatchObject({
      kind: "capture",
      captureId: capture.id,
    });

    await store.removeCapture("p1", capture.id);
    expect((await store.list("p1")).captures).toEqual([]);
    await expect(store.capture("p1", capture.id)).rejects.toMatchObject({ reason: "not_found" });
  });

  it("rejects paths escaping the workspace, including symlink traversal", async () => {
    await NodeFSP.writeFile(NodePath.join(directory, "outside.bin"), "secret");
    await NodeFSP.symlink(NodePath.join(directory, "outside.bin"), NodePath.join(root, "link.bin"));
    const base = { projectId: "p1", environmentId: "env1", workspaceRoot: root };
    await expect(store.importFile({ ...base, relativePath: "../outside.bin" })).rejects.toThrow();
    await expect(store.importFile({ ...base, relativePath: "link.bin" })).rejects.toThrow();
  });

  it("updates metadata without changing firmware bytes", async () => {
    await NodeFSP.writeFile(NodePath.join(root, "app.elf"), "test firmware");
    const first = await store.importFile({
      projectId: "p1",
      environmentId: "env1",
      workspaceRoot: root,
      relativePath: "app.elf",
    });
    const linked = await store.link("p1", first.investigation.id, {
      veritasProjectId: "vp1",
      boardRevisionId: "br1",
    });
    expect(linked.boardRevisionId).toBe("br1");
    expect((await store.list("p1")).artifacts[0]?.sha256).toBe(first.artifact.sha256);
  });

  it("clears a link with null and leaves omitted fields alone", async () => {
    await NodeFSP.writeFile(NodePath.join(root, "app.elf"), "test firmware");
    const { investigation } = await store.importFile({
      projectId: "p1",
      environmentId: "env1",
      workspaceRoot: root,
      relativePath: "app.elf",
    });
    await store.link("p1", investigation.id, { veritasProjectId: "vp1", boardRevisionId: "br1" });
    const cleared = await store.link("p1", investigation.id, { boardRevisionId: null });
    expect(cleared.veritasProjectId).toBe("vp1");
    expect(cleared.boardRevisionId).toBeUndefined();
  });

  it("deletes investigations and only collects firmware nobody references", async () => {
    await NodeFSP.writeFile(NodePath.join(root, "shared.bin"), "shared firmware");
    const base = { environmentId: "env1", workspaceRoot: root, relativePath: "shared.bin" };
    const one = await store.importFile({ ...base, projectId: "p1" });
    const two = await store.importFile({ ...base, projectId: "p2" });
    const bytes = NodePath.join(directory, "state", "reverse", "artifacts", one.artifact.sha256);
    // Older than the grace period that protects imports in flight.
    const old = (await NodeFSP.stat(bytes)).mtimeMs / 1000 - 2 * 60 * 60;
    await NodeFSP.utimes(bytes, old, old);

    await store.remove("p1", one.investigation.id);
    expect((await store.list("p1")).investigations).toHaveLength(0);
    await expect(NodeFSP.stat(bytes)).resolves.toBeDefined();

    await store.remove("p2", two.investigation.id);
    await expect(NodeFSP.stat(bytes)).rejects.toThrow();
    await expect(store.remove("p2", two.investigation.id)).rejects.toMatchObject({
      reason: "not_found",
    });
  });
});
