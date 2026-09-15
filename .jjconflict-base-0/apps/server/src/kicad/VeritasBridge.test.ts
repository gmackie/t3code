// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { discoverKiCadProject } from "./KiCadProject.ts";
import { VeritasBridge, type VeritasFetch } from "./VeritasBridge.ts";

let root: string, cwd: string, stateDir: string;
beforeEach(async () => {
  root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-veritas-test-"));
  cwd = NodePath.join(root, "board");
  stateDir = NodePath.join(root, "state");
  await NodeFSP.mkdir(cwd);
  await NodeFSP.writeFile(NodePath.join(cwd, "board.kicad_sch"), "(kicad_sch (version 20250114))");
  await NodeFSP.writeFile(NodePath.join(cwd, ".env"), "NEVER_SHARE=this-is-a-fixture");
});
afterEach(() => NodeFSP.rm(root, { recursive: true, force: true }));
const connection = {
  url: "https://veritas.example.test",
  token: "fixture-credential",
  publicUrl: "https://cad.example.test",
};
const json = (data: unknown) => Response.json({ result: { data: { json: data } } });
const line = {
  id: "part-1",
  refdesList: ["R1", "R2"],
  partNumber: "RES-10K",
  manufacturer: "Fixture",
  value: "10k",
  footprint: "0603",
  lcscNumber: "C100",
  unitPriceMicrousd: 10000,
  inStock: 1000,
  eol: "active",
  flags: [],
};
const manifest = () => discoverKiCadProject(cwd);

describe("CAD Veritas bridge", () => {
  it("shares an immutable CAD-only snapshot and remembers its review without resubmitting", async () => {
    const calls: Array<{ procedure: string; input: Record<string, unknown> }> = [];
    const fetchFn: VeritasFetch = async (url, init) => {
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture-credential");
      const input = JSON.parse(String(init?.body)).json;
      calls.push({ procedure: new URL(String(url)).pathname, input });
      return json({ reviewId: "review-1", projectId: "project-1", status: "pending" });
    };
    let now = 1000;
    const bridge = new VeritasBridge(stateDir, connection, fetchFn, () => now);
    const action = { type: "review", revision: (await manifest()).revision } as const;
    await bridge.action(cwd, action);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.procedure).toBe("/api/trpc/forgeReview.run");
    expect(calls[0]?.input.sourceKind).toBe("zip_url");
    const source = new URL(String(calls[0]?.input.source));
    expect(source.origin).toBe("https://cad.example.test");
    const token = source.pathname.split("/").at(-1)!;
    const path = await bridge.snapshotPath(token);
    expect(path).not.toBeNull();
    expect(
      await new VeritasBridge(stateDir, connection, fetchFn, () => now).snapshotPath(token),
    ).toBe(path);
    const archive = await NodeFSP.readFile(path!);
    const files = unzipSync(archive);
    expect(Object.keys(files)).toEqual(["board.kicad_sch"]);
    const original = strFromU8(files["board.kicad_sch"]!);
    await NodeFSP.writeFile(NodePath.join(cwd, "board.kicad_sch"), "edited after submission");
    expect(strFromU8(unzipSync(await NodeFSP.readFile(path!))["board.kicad_sch"]!)).toBe(original);
    const link = await bridge.readLink(cwd);
    expect(link.snapshotSha256).toBe(NodeCrypto.createHash("sha256").update(archive).digest("hex"));
    expect(link.reviewId).toBe("review-1");
    await bridge.action(cwd, action);
    expect(calls).toHaveLength(1);
    now += 31 * 60_000;
    expect(await bridge.snapshotPath(token)).toBeNull();
    expect(await bridge.snapshotPath("unknown")).toBeNull();
  });
  it("does not send credentials when the connection is absent", async () => {
    const bridge = new VeritasBridge(stateDir, null, async () => {
      throw new Error("Unexpected network request");
    });
    expect((await bridge.status(cwd, false)).configured).toBe(false);
    await expect(
      bridge.action(cwd, { type: "review", revision: (await manifest()).revision }),
    ).rejects.toThrow("VERITAS_CAD_PUBLIC_URL");
  });
  it("rejects stale design revisions before contacting Veritas", async () => {
    const bridge = new VeritasBridge(stateDir, connection, async () => {
      throw new Error("Unexpected request");
    });
    await expect(bridge.action(cwd, { type: "review", revision: "stale" })).rejects.toThrow(
      "changed",
    );
    expect((await bridge.readLink(cwd)).pendingOperation).toBeNull();
  });
  it("rejects same-size edits hidden by the discovery cache", async () => {
    const revision = (await manifest()).revision;
    const file = NodePath.join(cwd, "board.kicad_sch");
    const original = await NodeFSP.readFile(file, "utf8");
    await NodeFSP.writeFile(file, original.replace("20250114", "20250115"));
    await NodeFSP.utimes(file, 1, 1);
    let requests = 0;
    const bridge = new VeritasBridge(stateDir, connection, async () => {
      requests++;
      return json({});
    });
    await expect(bridge.action(cwd, { type: "review", revision })).rejects.toThrow("changed");
    expect(requests).toBe(0);
  });
  it("leaves uncertain remote submissions marked across restarts rather than duplicating them", async () => {
    let count = 0;
    const fetchFn: VeritasFetch = async () => {
      count++;
      throw new Error("connection lost after write");
    };
    const action = { type: "review", revision: (await manifest()).revision } as const;
    await expect(
      new VeritasBridge(stateDir, connection, fetchFn).action(cwd, action),
    ).rejects.toThrow("could not be reached");
    const restarted = new VeritasBridge(stateDir, connection, fetchFn);
    await expect(restarted.action(cwd, action)).rejects.toThrow("uncertain outcome");
    expect(count).toBe(1);
    expect((await restarted.readLink(cwd)).pendingOperation).toBe("review");
  });
  it("uses the completed review BOM and board quantity to prepare one production run", async () => {
    const calls: Array<{ procedure: string; input: unknown }> = [];
    const fetchFn: VeritasFetch = async (url, init) => {
      const parsed = new URL(String(url));
      const procedure = parsed.pathname.split("/").at(-1)!;
      const input = JSON.parse(
        init?.body ? String(init.body) : parsed.searchParams.get("input")!,
      ).json;
      calls.push({ procedure, input });
      if (procedure === "forgeReview.status")
        return json({
          review: {
            id: "review-1",
            projectId: "project-1",
            status: "complete",
            signedBundleUrl: "https://veritas.example.test/evidence",
            errorPayload: null,
          },
        });
      if (procedure === "forgeBom.list") return json({ lines: [line] });
      if (procedure === "productionRuns.create") return json({ run: { id: "run-1" } });
      if (procedure === "productionRuns.get")
        return json({
          run: { id: "run-1", name: "Board run", state: "sourced", boards: 10 },
          orders: [{ id: "order-1", kind: "parts", vendor: "fixture", status: "draft" }],
        });
      throw new Error(`Unexpected procedure ${procedure}`);
    };
    const bridge = new VeritasBridge(stateDir, connection, fetchFn);
    await bridge.action(cwd, {
      type: "link",
      projectId: null,
      reviewId: "review-1",
      productionRunId: null,
    });
    const action = {
      type: "production",
      reviewId: "review-1",
      boards: 10,
      route: "hand",
      fab: { layers: 4, widthMm: 80, heightMm: 60, finish: "enig" },
    } as const;
    await bridge.action(cwd, action);
    await bridge.action(cwd, action);
    const productionCalls = calls.filter((call) => call.procedure === "productionRuns.create");
    expect(productionCalls).toHaveLength(1);
    expect(productionCalls[0]?.input).toMatchObject({
      boards: 10,
      route: "hand",
      fab: { layers: 4, widthMm: 80, heightMm: 60, finish: "enig" },
      lines: [{ mpn: "RES-10K", qty: 2, refdes: ["R1", "R2"] }],
    });
    const status = await bridge.status(cwd, true);
    expect(status.link.projectId).toBe("project-1");
    expect(status.production?.state).toBe("sourced");
    expect(status.bom[0]?.partNumber).toBe("RES-10K");
  });
  it("keeps a broken remote link recoverable without disclosing its credentials", async () => {
    let available = true;
    const bridge = new VeritasBridge(stateDir, connection, async () => {
      if (!available) throw new Error("private credential detail");
      return json({ review: { projectId: "project-1", status: "complete" } });
    });
    await bridge.action(cwd, {
      type: "link",
      projectId: "project-1",
      reviewId: "review-1",
      productionRunId: null,
    });
    available = false;
    const status = await bridge.status(cwd, true);
    expect(status.link.reviewId).toBe("review-1");
    expect(status.canOperate).toBe(true);
    expect(status.remoteError).toContain("unlink");
    expect(JSON.stringify(status)).not.toContain("private credential");
    await bridge.action(cwd, { type: "unlink" });
    expect((await bridge.status(cwd, true)).remoteError).toBeNull();
  });
  it("does not prepare production from a potentially truncated BOM", async () => {
    let mutations = 0;
    const bridge = new VeritasBridge(stateDir, connection, async (url, init) => {
      if (init?.method === "POST") mutations++;
      return String(url).includes("forgeBom.list")
        ? json({
            lines: Array.from({ length: 500 }, (_, index) => ({ ...line, id: `line-${index}` })),
          })
        : json({ review: { projectId: "project-1", status: "complete" } });
    });
    await bridge.action(cwd, {
      type: "link",
      projectId: "project-1",
      reviewId: "review-1",
      productionRunId: null,
    });
    await expect(
      bridge.action(cwd, {
        type: "production",
        reviewId: "review-1",
        boards: 1,
        route: "hand",
        fab: { layers: 2, widthMm: 20, heightMm: 30, finish: "hasl" },
      }),
    ).rejects.toThrow("500-line BOM limit");
    expect(mutations).toBe(0);
    expect((await bridge.readLink(cwd)).pendingOperation).toBeNull();
  });
  it("rejects a review belonging to another project and leaves the link unchanged", async () => {
    const bridge = new VeritasBridge(stateDir, connection, async () =>
      json({ review: { projectId: "different-project" } }),
    );
    await expect(
      bridge.action(cwd, {
        type: "link",
        projectId: "project-1",
        reviewId: "foreign-review",
        productionRunId: null,
      }),
    ).rejects.toThrow("different Veritas project");
    expect((await bridge.readLink(cwd)).projectId).toBeNull();
  });
  it("never exposes a non-web evidence URL", async () => {
    const bridge = new VeritasBridge(stateDir, connection, async (url) =>
      String(url).includes("forgeBom")
        ? json({ lines: [] })
        : json({
            review: {
              projectId: "project-1",
              status: "complete",
              signedBundleUrl: "javascript:alert(1)",
            },
          }),
    );
    await bridge.action(cwd, {
      type: "link",
      projectId: "project-1",
      reviewId: "review-1",
      productionRunId: null,
    });
    expect((await bridge.status(cwd, false)).review?.signedBundleUrl).toBeNull();
  });
});
