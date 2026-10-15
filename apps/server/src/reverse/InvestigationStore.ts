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
const MAX_STRING_VALUE = 512;
const ARTIFACT_GRACE_MS = 60 * 60 * 1000;
type StringScan = { strings: Array<{ offset: number; value: string }>; truncated: boolean };
const STRING_SCAN_CACHE = 16;
async function scanStrings(path: string, minLength: number): Promise<StringScan> {
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
        if (value.length < MAX_STRING_VALUE) value += String.fromCharCode(byte);
      } else {
        if (value.length >= minLength && start >= 0) strings.push({ offset: start, value });
        start = -1;
        value = "";
      }
      offset++;
    }
    if (truncated) break;
  }
  if (!truncated && value.length >= minLength && start >= 0) strings.push({ offset: start, value });
  return { strings, truncated };
}
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
    const artifactsDir = NodePath.join(this.stateDir, "reverse", "artifacts");
    await NodeFSP.mkdir(artifactsDir, { recursive: true });
    const stagingPath = NodePath.join(artifactsDir, `.${NodeCrypto.randomUUID()}.tmp`);
    // Copy from one open handle, checked to be the contained file, so swapping a path
    // component for a symlink after the check cannot redirect the copy.
    const source = await NodeFSP.open(
      real,
      NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW,
    ).catch(() => {
      throw err("invalid_file", "Firmware input must be a regular file.");
    });
    try {
      const opened = await source.stat();
      if (!opened.isFile()) throw err("invalid_file", "Firmware input must be a regular file.");
      if (opened.size > MAX_IMPORT_BYTES)
        throw err("too_large", "Firmware input exceeds the 512 MiB import limit.");
      const current = await NodeFSP.realpath(target);
      const named = await NodeFSP.stat(current);
      if (current !== real || named.dev !== opened.dev || named.ino !== opened.ino)
        throw err("outside_workspace", "Firmware file changed while it was being imported.");
      const hash = NodeCrypto.createHash("sha256");
      const staging = await NodeFSP.open(stagingPath, "wx", 0o600);
      let copiedBytes = 0;
      try {
        const buffer = Buffer.alloc(1024 * 1024);
        for (;;) {
          const { bytesRead } = await source.read(buffer, 0, buffer.length, copiedBytes);
          if (bytesRead === 0) break;
          copiedBytes += bytesRead;
          if (copiedBytes > MAX_IMPORT_BYTES)
            throw err("too_large", "Firmware input exceeded import size limit.");
          const chunk = buffer.subarray(0, bytesRead);
          hash.update(chunk);
          await staging.write(chunk);
        }
      } finally {
        await staging.close();
      }
      const sha256 = hash.digest("hex");
      const artifact: ReverseFirmwareArtifact = {
        sha256,
        sizeBytes: copiedBytes,
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
      await source.close();
      await NodeFSP.rm(stagingPath, { force: true }).catch(() => undefined);
    }
  }

  link(
    projectId: string,
    investigationId: string,
    update: {
      veritasProjectId?: string | null | undefined;
      boardRevisionId?: string | null | undefined;
    },
  ): Promise<ReverseInvestigation> {
    return this.locked(projectId, async () => {
      const record = await readProject(this.stateDir, projectId);
      const index = record.investigations.findIndex((x) => x.id === investigationId);
      if (index < 0) throw err("not_found", "Investigation not found in this project.");
      const { veritasProjectId, boardRevisionId, ...rest } = record.investigations[index]!;
      // Omitted fields stay as they are; null removes the link.
      const keep = (value: string | null | undefined, current: string | undefined) =>
        value === undefined ? current : (value ?? undefined);
      const nextProject = keep(update.veritasProjectId, veritasProjectId);
      const nextBoard = keep(update.boardRevisionId, boardRevisionId);
      const next: ReverseInvestigation = {
        ...rest,
        ...(nextProject ? { veritasProjectId: nextProject } : {}),
        ...(nextBoard ? { boardRevisionId: nextBoard } : {}),
      };
      record.investigations[index] = next;
      await saveProject(this.stateDir, projectId, record);
      return next;
    });
  }

  /** Removes an investigation; its firmware bytes go once no project references them. */
  async remove(projectId: string, investigationId: string): Promise<void> {
    await this.locked(projectId, async () => {
      const record = await readProject(this.stateDir, projectId);
      const investigation = record.investigations.find((x) => x.id === investigationId);
      if (!investigation) throw err("not_found", "Investigation not found in this project.");
      record.investigations = record.investigations.filter((x) => x.id !== investigationId);
      record.artifacts = record.artifacts.filter(
        (artifact) =>
          artifact.sha256 !== investigation.artifactSha256 ||
          record.investigations.some((x) => x.artifactSha256 === artifact.sha256),
      );
      await saveProject(this.stateDir, projectId, record);
    });
    await this.collectArtifacts().catch(() => undefined);
  }

  // Skips recent files: another project's import renames its artifact before saving its record.
  private async collectArtifacts(): Promise<void> {
    const projects = NodePath.join(this.stateDir, "reverse", "projects");
    const referenced = new Set<string>();
    for (const name of await NodeFSP.readdir(projects).catch(() => [])) {
      if (!name.endsWith(".json")) continue;
      const value = JSON.parse(await NodeFSP.readFile(NodePath.join(projects, name), "utf8"));
      for (const artifact of (decode(value) as ProjectRecord).artifacts)
        referenced.add(artifact.sha256);
    }
    const artifacts = NodePath.join(this.stateDir, "reverse", "artifacts");
    for (const name of await NodeFSP.readdir(artifacts).catch(() => [])) {
      if (!/^[a-f0-9]{64}$/.test(name) || referenced.has(name)) continue;
      const full = NodePath.join(artifacts, name);
      const stat = await NodeFSP.stat(full).catch(() => null);
      if (stat && performance.timeOrigin + performance.now() - stat.mtimeMs > ARTIFACT_GRACE_MS)
        await NodeFSP.rm(full, { force: true });
    }
  }

  // Artifacts are immutable, so scans are shared per digest and minimum length.
  private readonly stringScans = new Map<string, Promise<StringScan>>();
  async strings(projectId: string, investigationId: string, minLength = 4): Promise<StringScan> {
    const record = await readProject(this.stateDir, projectId);
    const investigation = record.investigations.find((x) => x.id === investigationId);
    if (!investigation) throw err("not_found", "Investigation not found in this project.");
    const key = `${investigation.artifactSha256}:${minLength}`;
    const cached = this.stringScans.get(key);
    if (cached) return cached;
    const oldest = this.stringScans.keys().next();
    if (this.stringScans.size >= STRING_SCAN_CACHE && !oldest.done)
      this.stringScans.delete(oldest.value);
    const scan = scanStrings(artifactPath(this.stateDir, investigation.artifactSha256), minLength);
    this.stringScans.set(key, scan);
    scan.catch(() => this.stringScans.delete(key));
    return scan;
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
