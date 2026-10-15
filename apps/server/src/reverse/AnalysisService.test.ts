// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { ReverseAnalysisService, ToolSlots } from "./AnalysisService.ts";
import { ReverseInvestigationStore } from "./InvestigationStore.ts";

describe("analysis worker slots", () => {
  it("runs a few tools at once, queues a few more, and refuses the rest", async () => {
    const slots = new ToolSlots(2, 1);
    const releases: Array<() => void> = [];
    let started = 0;
    const job = () =>
      slots.use(
        () =>
          new Promise<number>((resolve) => {
            const order = ++started;
            releases.push(() => resolve(order));
          }),
      );
    const first = job();
    const second = job();
    const queued = job();
    await expect(job()).rejects.toMatchObject({ reason: "unavailable" });
    await Promise.resolve();
    expect(started).toBe(2);

    releases[0]!();
    expect(await first).toBe(1);
    // A job arriving as a slot frees up waits its turn instead of jumping in beside the waiter.
    const late = job();
    await Promise.resolve();
    expect(started).toBe(3);
    releases[1]!();
    releases[2]!();
    expect(await Promise.all([second, queued])).toEqual([2, 3]);
    await Promise.resolve();
    expect(started).toBe(4);
    releases[3]!();
    expect(await late).toBe(4);
  });
});

describe("extracted firmware", () => {
  it("opens a file from this firmware's extraction as a linked investigation", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-extracted-"));
    try {
      const state = NodePath.join(root, "state");
      const store = new ReverseInvestigationStore(state);
      const analysis = new ReverseAnalysisService(state, store);
      await NodeFSP.mkdir(NodePath.join(root, "ws"));
      await NodeFSP.writeFile(NodePath.join(root, "ws", "vendor.img"), "vendor image");
      const parent = await store.importFile({
        projectId: "p1",
        environmentId: "env1",
        workspaceRoot: NodePath.join(root, "ws"),
        relativePath: "vendor.img",
      });
      // An Unblob receipt as AnalysisService leaves it.
      const receiptId = NodeCrypto.randomUUID();
      const owner = NodeCrypto.createHash("sha256").update("p1").digest("hex");
      const receipt = NodePath.join(state, "reverse", "analysis", owner, receiptId);
      await NodeFSP.mkdir(NodePath.join(receipt, "extracted", "rootfs"), { recursive: true });
      await NodeFSP.writeFile(NodePath.join(receipt, "extracted", "rootfs", "app.elf"), "inner");
      await NodeFSP.writeFile(
        NodePath.join(receipt, "receipt.json"),
        JSON.stringify({ artifactSha256: parent.artifact.sha256 }),
      );

      await expect(analysis.extractedRoot("p1", receiptId, "f".repeat(64))).rejects.toMatchObject({
        reason: "not_found",
      });
      const child = await store.importFile({
        projectId: "p1",
        environmentId: "env1",
        workspaceRoot: await analysis.extractedRoot("p1", receiptId, parent.artifact.sha256),
        relativePath: "rootfs/app.elf",
        origin: {
          parentInvestigationId: parent.investigation.id,
          parentSha256: parent.artifact.sha256,
          label: "vendor.img → rootfs/app.elf",
        },
      });
      expect(child.investigation.parentInvestigationId).toBe(parent.investigation.id);
      expect(child.artifact).toMatchObject({
        parentSha256: parent.artifact.sha256,
        sourcePath: "vendor.img → rootfs/app.elf",
      });
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });
});
