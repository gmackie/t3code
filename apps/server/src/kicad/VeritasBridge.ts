// @effect-diagnostics nodeBuiltinImport:off globalDate:off
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { zip } from "fflate";
import * as Schema from "effect/Schema";
import {
  VeritasCadBomLine,
  VeritasCadLink,
  type VeritasCadAction,
  type VeritasCadStatus,
} from "@t3tools/contracts";
import { discoverKiCadProject, resolveKiCadProjectFile } from "./KiCadProject.ts";

const emptyLink: VeritasCadLink = {
  projectId: null,
  reviewId: null,
  productionRunId: null,
  snapshotRevision: null,
  snapshotSha256: null,
  pendingOperation: null,
};
const MAX_SNAPSHOT_BYTES = 40 * 1024 * 1024;
const SNAPSHOT_LIFETIME_MS = 30 * 60_000;
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const string = (value: unknown) => (typeof value === "string" ? value : null);
const safeWebUrl = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
};

export type VeritasFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface VeritasConnection {
  readonly url: string;
  readonly token: string;
  /** Address that the Veritas review agent can use to fetch this T3 environment. */
  readonly publicUrl?: string;
}

/** The adapter owns remote credentials, immutable handoffs, and uncertain mutation state. */
export class VeritasBridge {
  private readonly active = new Set<string>();
  private readonly snapshots = new Map<string, { path: string; expiresAt: number }>();
  private readonly stateDir: string;
  private readonly connection: VeritasConnection | null;
  private readonly fetchFn: VeritasFetch;
  private readonly now: () => number;
  constructor(
    stateDir: string,
    connection: VeritasConnection | null,
    fetchFn: VeritasFetch = fetch,
    now = Date.now,
  ) {
    this.stateDir = stateDir;
    this.connection = connection;
    this.fetchFn = fetchFn;
    this.now = now;
  }

  private linkPath(cwd: string) {
    return NodePath.join(
      this.stateDir,
      "cad-veritas",
      `${NodeCrypto.createHash("sha256").update(cwd).digest("hex")}.json`,
    );
  }
  async readLink(cwd: string): Promise<VeritasCadLink> {
    try {
      return Schema.decodeUnknownSync(VeritasCadLink)(
        JSON.parse(await NodeFSP.readFile(this.linkPath(cwd), "utf8")),
      );
    } catch (error) {
      if (object(error).code === "ENOENT") return { ...emptyLink };
      throw new Error("The saved Veritas connection could not be read.");
    }
  }
  private async saveLink(cwd: string, link: VeritasCadLink) {
    const path = this.linkPath(cwd);
    await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true });
    const temporary = `${path}.${NodeCrypto.randomUUID()}.tmp`;
    await NodeFSP.writeFile(temporary, JSON.stringify(link), { mode: 0o600 });
    await NodeFSP.rename(temporary, path);
  }
  private async rpc(procedure: string, input: unknown, mutation = false): Promise<unknown> {
    const connection = this.connection;
    if (!connection?.token || !safeWebUrl(connection.url))
      throw new Error(
        "Configure VERITAS_URL and VERITAS_API_TOKEN on this T3 server to connect Veritas.",
      );
    const url = new URL(`${connection.url.replace(/\/$/, "")}/api/trpc/${procedure}`);
    const payload = JSON.stringify({ json: input });
    if (!mutation) url.searchParams.set("input", payload);
    let response: Response;
    try {
      response = await this.fetchFn(url, {
        method: mutation ? "POST" : "GET",
        headers: {
          Authorization: `Bearer ${connection.token}`,
          "Content-Type": "application/json",
        },
        ...(mutation ? { body: payload } : {}),
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new Error(
        "Veritas could not be reached. Check its connection and review any submitted operation in Veritas before retrying.",
      );
    }
    if (!response.ok)
      throw new Error(
        response.status === 401 || response.status === 403
          ? "Veritas rejected this server's credentials or scopes."
          : `Veritas request failed (${response.status}). Check the linked project in Veritas.`,
      );
    const result = object(await response.json());
    if (result.error)
      throw new Error("Veritas rejected the request. Check the linked project and token scopes.");
    const data = object(object(result.result).data);
    if (!("json" in data)) throw new Error("Veritas returned an unsupported response.");
    return data.json;
  }
  private async review(reviewId: string) {
    return object(object(await this.rpc("forgeReview.status", { reviewId })).review);
  }
  private async bom(reviewId: string) {
    const result = object(await this.rpc("forgeBom.list", { reviewId, limit: 500 }));
    return Schema.decodeUnknownSync(Schema.Array(VeritasCadBomLine))(result.lines);
  }
  async status(cwd: string, canOperate: boolean): Promise<VeritasCadStatus> {
    const link = await this.readLink(cwd);
    const configured = Boolean(this.connection?.token && safeWebUrl(this.connection.url));
    const base = {
      configured,
      canOperate,
      canShareSnapshot: Boolean(
        this.connection?.publicUrl && safeWebUrl(this.connection.publicUrl),
      ),
      link,
      remoteError: null,
      review: null,
      bom: [],
      production: null,
    };
    if (!configured) return base;
    const results = await Promise.all([
      link.reviewId ? this.review(link.reviewId) : null,
      link.reviewId ? this.bom(link.reviewId) : [],
      link.productionRunId ? this.rpc("productionRuns.get", { runId: link.productionRunId }) : null,
    ]).catch(() => null);
    if (!results)
      return {
        ...base,
        remoteError:
          "Unable to load linked Veritas data. Check this server’s credentials and the linked IDs, or unlink the workspace to reconnect.",
      };
    const [review, bom, productionResult] = results;
    const production = object(productionResult),
      run = object(production.run);
    return {
      ...base,
      bom,
      review: review
        ? {
            id: link.reviewId!,
            status: string(review.status) ?? "unknown",
            signedBundleUrl: safeWebUrl(review.signedBundleUrl),
            error: string(object(review.errorPayload).problem),
          }
        : null,
      production: productionResult
        ? {
            id: link.productionRunId!,
            name: string(run.name) ?? "Production run",
            state: string(run.state) ?? "unknown",
            boards: typeof run.boards === "number" ? run.boards : 0,
            orders: Array.isArray(production.orders)
              ? production.orders.map((value) => {
                  const order = object(value);
                  return {
                    id: string(order.id) ?? "",
                    kind: string(order.kind) ?? "",
                    vendor: string(order.vendor) ?? "",
                    status: string(order.status) ?? "unknown",
                  };
                })
              : [],
          }
        : null,
    };
  }
  async snapshotPath(token: string): Promise<string | null> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const path = NodePath.join(this.stateDir, "cad-veritas", "snapshots", `${token}.zip`);
    let snapshot = this.snapshots.get(token);
    if (!snapshot) {
      try {
        const metadata = object(JSON.parse(await NodeFSP.readFile(`${path}.json`, "utf8")));
        if (typeof metadata.expiresAt !== "number") return null;
        snapshot = { path, expiresAt: metadata.expiresAt };
      } catch {
        return null;
      }
    }
    if (snapshot.expiresAt <= this.now()) {
      this.snapshots.delete(token);
      await Promise.all([
        NodeFSP.rm(path, { force: true }),
        NodeFSP.rm(`${path}.json`, { force: true }),
      ]);
      return null;
    }
    this.snapshots.set(token, snapshot);
    return snapshot.path;
  }
  private async snapshot(cwd: string, expectedRevision: string) {
    const manifest = await discoverKiCadProject(cwd);
    if (manifest.revision !== expectedRevision)
      throw new Error("The saved design changed. Refresh CAD before submitting it.");
    if (manifest.warnings.length)
      throw new Error("Resolve the CAD discovery warnings before sharing a design snapshot.");
    if (!manifest.files.some((file) => file.kind === "schematic"))
      throw new Error("Veritas review needs a saved KiCad schematic.");
    const files: Record<string, Uint8Array> = {};
    let size = 0;
    for (const file of manifest.files) {
      if ((size += file.size) > MAX_SNAPSHOT_BYTES)
        throw new Error("This CAD snapshot exceeds the 40 MB review limit.");
      const resolved = await resolveKiCadProjectFile(cwd, file.path);
      if (!resolved)
        throw new Error("A CAD file changed or left the workspace. Refresh and retry.");
      const bytes = await NodeFSP.readFile(resolved.absolutePath);
      const afterRead = await NodeFSP.stat(resolved.absolutePath);
      if (
        bytes.length !== file.size ||
        afterRead.size !== file.size ||
        afterRead.mtimeMs !== file.mtimeMs
      )
        throw new Error("A CAD file changed during export. Refresh and retry.");
      files[file.path] = bytes;
    }
    const bytes = await new Promise<Uint8Array>((resolve, reject) =>
      zip(files, { level: 0 }, (error, data) => (error ? reject(error) : resolve(data))),
    );
    const sha256 = NodeCrypto.createHash("sha256").update(bytes).digest("hex");
    const directory = NodePath.join(this.stateDir, "cad-veritas", "snapshots");
    await NodeFSP.mkdir(directory, { recursive: true });
    for (const name of await NodeFSP.readdir(directory)) {
      if (name.endsWith(".zip.json")) await this.snapshotPath(name.slice(0, -9));
    }
    if (this.snapshots.size >= 8)
      throw new Error(
        "Several design snapshots are still awaiting review. Try again after they expire.",
      );
    const token = NodeCrypto.randomBytes(32).toString("base64url");
    const path = NodePath.join(directory, `${token}.zip`);
    await NodeFSP.writeFile(path, bytes, { mode: 0o600 });
    const expiresAt = this.now() + SNAPSHOT_LIFETIME_MS;
    await NodeFSP.writeFile(`${path}.json`, JSON.stringify({ expiresAt }), { mode: 0o600 });
    this.snapshots.set(token, { path, expiresAt });
    return { token, sha256, revision: manifest.revision };
  }
  async action(cwd: string, action: VeritasCadAction): Promise<void> {
    if (this.active.has(cwd))
      throw new Error("A Veritas operation is already running for this workspace.");
    this.active.add(cwd);
    try {
      const link = await this.readLink(cwd);
      if (action.type === "unlink") {
        await this.saveLink(cwd, { ...emptyLink });
        return;
      }
      if (action.type === "link") {
        if (action.reviewId) {
          const review = await this.review(action.reviewId);
          if (action.projectId && review.projectId !== action.projectId)
            throw new Error("The review belongs to a different Veritas project.");
          if (!action.projectId) action = { ...action, projectId: string(review.projectId) };
        }
        if (action.productionRunId)
          await this.rpc("productionRuns.get", { runId: action.productionRunId });
        await this.saveLink(cwd, {
          ...emptyLink,
          projectId: action.projectId,
          reviewId: action.reviewId,
          productionRunId: action.productionRunId,
        });
        return;
      }
      if (link.pendingOperation)
        throw new Error(
          "A previous submission has an uncertain outcome. Check Veritas and link its review or run before submitting again.",
        );
      if (action.type === "review") {
        if (link.reviewId && link.snapshotRevision === action.revision) return;
        const publicUrl = this.connection?.publicUrl && safeWebUrl(this.connection.publicUrl);
        if (!publicUrl)
          throw new Error(
            "Set VERITAS_CAD_PUBLIC_URL to this T3 server's address reachable by the Veritas review agent.",
          );
        const snapshot = await this.snapshot(cwd, action.revision);
        const source = `${publicUrl.replace(/\/$/, "")}/api/kicad/veritas/snapshot/${snapshot.token}`;
        await this.saveLink(cwd, { ...link, pendingOperation: "review" });
        const result = object(
          await this.rpc(
            "forgeReview.run",
            {
              source,
              sourceKind: "zip_url",
              ...(link.projectId ? { projectId: link.projectId } : {}),
              wait: false,
            },
            true,
          ),
        );
        const reviewId = string(result.reviewId),
          projectId = string(result.projectId);
        if (!reviewId || !projectId)
          throw new Error(
            "Veritas did not return a review identity. Check Veritas before submitting again.",
          );
        await this.saveLink(cwd, {
          projectId,
          reviewId,
          productionRunId: null,
          snapshotRevision: snapshot.revision,
          snapshotSha256: snapshot.sha256,
          pendingOperation: null,
        });
        return;
      }
      if (action.reviewId !== link.reviewId || !link.reviewId)
        throw new Error("Refresh the linked review before preparing production.");
      if (link.productionRunId) return;
      const review = await this.review(link.reviewId);
      if (review.status !== "complete")
        throw new Error("Complete the Veritas design review before preparing production.");
      const bom = await this.bom(link.reviewId);
      if (bom.length >= 500)
        throw new Error(
          "Veritas returned its 500-line BOM limit. Confirm the complete BOM in Veritas before preparing production there.",
        );
      if (!bom.length || bom.some((line) => !line.partNumber || !line.refdesList.length))
        throw new Error(
          "Resolve missing part numbers and references in the reviewed BOM before preparing production.",
        );
      await this.saveLink(cwd, { ...link, pendingOperation: "production" });
      const result = object(
        await this.rpc(
          "productionRuns.create",
          {
            name: `${NodePath.basename(cwd)} · review ${link.reviewId}`,
            boards: action.boards,
            route: action.route,
            fab: action.fab,
            lines: bom.map((line) => ({
              mpn: line.partNumber,
              qty: line.refdesList.length,
              refdes: line.refdesList,
            })),
          },
          true,
        ),
      );
      const productionRunId = string(object(result.run).id);
      if (!productionRunId)
        throw new Error(
          "Veritas did not return a production run identity. Check Veritas before submitting again.",
        );
      await this.saveLink(cwd, { ...link, productionRunId, pendingOperation: null });
    } finally {
      this.active.delete(cwd);
    }
  }
}
