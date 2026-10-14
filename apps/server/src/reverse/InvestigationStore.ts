// @effect-diagnostics nodeBuiltinImport:off - device firmware is an explicitly host-owned artifact.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import {
  ReverseStoreError,
  type ReverseFirmwareArtifact,
  type ReverseInvestigation,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

type ProjectRecord = {
  investigations: ReverseInvestigation[];
  artifacts: ReverseFirmwareArtifact[];
};

const empty = (): ProjectRecord => ({ investigations: [], artifacts: [] });
const decode = Schema.decodeUnknownSync(
  Schema.Struct({
    investigations: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        projectId: Schema.String,
        environmentId: Schema.String,
        veritasProjectId: Schema.optional(Schema.String),
        boardRevisionId: Schema.optional(Schema.String),
        artifactSha256: Schema.String,
        ghidraSessionId: Schema.optional(Schema.String),
      }),
    ),
    artifacts: Schema.Array(
      Schema.Struct({
        sha256: Schema.String,
        sizeBytes: Schema.Number,
        filename: Schema.String,
        sourcePath: Schema.String,
        importedAt: Schema.String,
      }),
    ),
  }),
);
const MAX_IMPORT_BYTES = 512 * 1024 * 1024;
const MAX_STRING_BYTES = 32 * 1024 * 1024;
const MAX_STRING_RESULTS = 2_000;
const storagePath = (stateDir: string, projectId: string) =>
  NodePath.join(
    stateDir,
    "reverse",
    "projects",
    `${NodeCrypto.createHash("sha256").update(projectId).digest("hex")}.json`,
  );
const artifactPath = (stateDir: string, digest: string) =>
  NodePath.join(stateDir, "reverse", "artifacts", digest);
const err = (reason: ReverseStoreError["reason"], message: string) =>
  new ReverseStoreError({ reason, message });

async function readProject(stateDir: string, projectId: string): Promise<ProjectRecord> {
  try {
    const value = JSON.parse(await NodeFSP.readFile(storagePath(stateDir, projectId), "utf8"));
    return decode(value) as ProjectRecord;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return empty();
    throw error;
  }
}

async function saveProject(stateDir: string, projectId: string, value: ProjectRecord) {
  const dest = storagePath(stateDir, projectId);
  await NodeFSP.mkdir(NodePath.dirname(dest), { recursive: true });
  const temp = `${dest}.${NodeCrypto.randomUUID()}.tmp`;
  try {
    await NodeFSP.writeFile(temp, JSON.stringify(value), { mode: 0o600 });
    await NodeFSP.rename(temp, dest);
  } finally {
    await NodeFSP.rm(temp, { force: true }).catch(() => undefined);
  }
}

/**
 * Session lifetime belongs to the T3 environment, not an Electron renderer.
 * Storage is scoped per project and the lock guards lost updates from concurrent RPC calls.
 */
export class ReverseInvestigationStore {
  private readonly stateDir: string;
  private readonly locks = new Map<string, Promise<void>>();
  constructor(stateDir: string) {
    this.stateDir = stateDir;
  }

  private async locked<T>(projectId: string, job: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(projectId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = prev.then(() => current);
    this.locks.set(projectId, tail);
    await prev;
    try {
      return await job();
    } finally {
      release();
      if (this.locks.get(projectId) === tail) this.locks.delete(projectId);
    }
  }

  list(projectId: string): Promise<ProjectRecord> {
    return readProject(this.stateDir, projectId);
  }

  async importFile(input: {
    projectId: string;
    workspaceRoot: string;
    relativePath: string;
    environmentId: string;
  }): Promise<{ investigation: ReverseInvestigation; artifact: ReverseFirmwareArtifact }> {
    const { projectId, relativePath } = input;
    if (
      NodePath.isAbsolute(relativePath) ||
      relativePath.includes("\0") ||
      relativePath.trim() === "" ||
      relativePath.split(/[\\/]/u).includes("..")
    ) {
      throw err("outside_workspace", "Select a relative path within the project workspace.");
    }
    const root = await NodeFSP.realpath(input.workspaceRoot);
    const target = NodePath.resolve(root, relativePath);
    const real = await NodeFSP.realpath(target);
    if (!real.startsWith(root + NodePath.sep))
      throw err("outside_workspace", "Firmware file resolves outside the project workspace.");
    const stat = await NodeFSP.stat(real);
    if (!stat.isFile()) throw err("invalid_file", "Firmware input must be a regular file.");
    if (stat.size > MAX_IMPORT_BYTES)
      throw err("too_large", "Firmware input exceeds the 512 MiB import limit.");

    const artifactsDir = NodePath.join(this.stateDir, "reverse", "artifacts");
    await NodeFSP.mkdir(artifactsDir, { recursive: true });
    const stagingPath = NodePath.join(artifactsDir, `.${NodeCrypto.randomUUID()}.tmp`);
    try {
      await NodeFSP.copyFile(real, stagingPath);
      const copied = await NodeFSP.stat(stagingPath);
      if (copied.size > MAX_IMPORT_BYTES)
        throw err("too_large", "Firmware input exceeded import size limit.");
      const hash = NodeCrypto.createHash("sha256");
      for await (const chunk of NodeFS.createReadStream(stagingPath)) hash.update(chunk);
      const sha256 = hash.digest("hex");
      const artifact: ReverseFirmwareArtifact = {
        sha256,
        sizeBytes: copied.size,
        filename: NodePath.basename(relativePath),
        sourcePath: relativePath,
        importedAt: DateTime.formatIso(DateTime.nowUnsafe()),
      };
      await NodeFSP.rename(stagingPath, artifactPath(this.stateDir, sha256));
      return await this.locked(projectId, async () => {
        const record = await readProject(this.stateDir, projectId);
        const prior = record.investigations.find((x) => x.artifactSha256 === sha256);
        const investigation: ReverseInvestigation = prior ?? {
          id: NodeCrypto.randomUUID(),
          projectId,
          environmentId: input.environmentId,
          artifactSha256: sha256,
        };
        if (!prior) {
          record.investigations.push(investigation);
          record.artifacts.push(artifact);
          await saveProject(this.stateDir, projectId, record);
        }
        return {
          investigation,
          artifact: record.artifacts.find((x) => x.sha256 === sha256) ?? artifact,
        };
      });
    } finally {
      await NodeFSP.rm(stagingPath, { force: true }).catch(() => undefined);
    }
  }

  link(
    projectId: string,
    investigationId: string,
    update: {
      veritasProjectId?: string;
      boardRevisionId?: string;
    },
  ): Promise<ReverseInvestigation> {
    return this.locked(projectId, async () => {
      const record = await readProject(this.stateDir, projectId);
      const index = record.investigations.findIndex((x) => x.id === investigationId);
      if (index < 0) throw err("not_found", "Investigation not found in this project.");
      const existing = record.investigations[index]!;
      const next = { ...existing, ...update };
      record.investigations[index] = next;
      await saveProject(this.stateDir, projectId, record);
      return next;
    });
  }

  async strings(projectId: string, investigationId: string, minLength = 4) {
    const record = await readProject(this.stateDir, projectId);
    const investigation = record.investigations.find((x) => x.id === investigationId);
    if (!investigation) throw err("not_found", "Investigation not found in this project.");
    const path = artifactPath(this.stateDir, investigation.artifactSha256);
    const strings: Array<{ offset: number; value: string }> = [];
    let offset = 0,
      start = -1,
      value = "",
      truncated = false;
    for await (const chunk of NodeFS.createReadStream(path, { highWaterMark: 65536 })) {
      const bytes = chunk as Buffer;
      for (let i = 0; i < bytes.length; i++) {
        if (offset >= MAX_STRING_BYTES || strings.length >= MAX_STRING_RESULTS) {
          truncated = true;
          break;
        }
        const byte = bytes[i]!;
        const printable = byte >= 32 && byte <= 126;
        if (printable) {
          if (start < 0) start = offset;
          if (value.length < 4096) value += String.fromCharCode(byte);
        } else {
          if (value.length >= minLength && start >= 0) strings.push({ offset: start, value });
          start = -1;
          value = "";
        }
        offset++;
      }
      if (truncated) break;
    }
    if (!truncated && value.length >= minLength && start >= 0)
      strings.push({ offset: start, value });
    return { strings, truncated };
  }

  getArtifact(
    projectId: string,
    investigationId: string,
  ): Promise<{ artifact: ReverseFirmwareArtifact; path: string }> {
    return readProject(this.stateDir, projectId).then((record) => {
      const investigation = record.investigations.find((x) => x.id === investigationId);
      if (!investigation) throw err("not_found", "Investigation not found in this project.");
      const artifact = record.artifacts.find((x) => x.sha256 === investigation.artifactSha256);
      if (!artifact) throw err("not_found", "Firmware artifact metadata missing.");
      return { artifact, path: artifactPath(this.stateDir, artifact.sha256) };
    });
  }
}

/** One lock domain for all connections on this environment server. */
const stores = new Map<string, ReverseInvestigationStore>();
export function getReverseInvestigationStore(stateDir: string): ReverseInvestigationStore {
  const existing = stores.get(stateDir);
  if (existing) return existing;
  const store = new ReverseInvestigationStore(stateDir);
  stores.set(stateDir, store);
  return store;
}
