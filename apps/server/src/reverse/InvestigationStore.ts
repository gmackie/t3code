// @effect-diagnostics nodeBuiltinImport:off - device firmware is an explicitly host-owned artifact.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import {
  ReverseCapture,
  ReverseFindingRecord,
  ReverseStoreError,
  type ReverseFirmwareArtifact,
  type ReverseInvestigation,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { CaptureFormatError, parseCapture, type ParsedCapture } from "./CaptureFormats.ts";

type ProjectRecord = {
  investigations: ReverseInvestigation[];
  artifacts: ReverseFirmwareArtifact[];
  findings: ReverseFindingRecord[];
  captures: ReverseCapture[];
};
type FindingStatus = ReverseFindingRecord["status"];

const empty = (): ProjectRecord => ({
  investigations: [],
  artifacts: [],
  findings: [],
  captures: [],
});
const MAX_CAPTURE_BYTES = 256 * 1024 * 1024;
const PARSED_CAPTURE_CACHE = 4;
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
        parentInvestigationId: Schema.optional(Schema.String),
        veritasArtifactId: Schema.optional(Schema.String),
        veritasBoardRevisionId: Schema.optional(Schema.NullOr(Schema.String)),
        ghidraProfile: Schema.optional(
          Schema.Struct({
            languageId: Schema.optional(Schema.String),
            imageBase: Schema.optional(Schema.String),
          }),
        ),
      }),
    ),
    artifacts: Schema.Array(
      Schema.Struct({
        sha256: Schema.String,
        sizeBytes: Schema.Number,
        filename: Schema.String,
        sourcePath: Schema.String,
        importedAt: Schema.String,
        parentSha256: Schema.optional(Schema.String),
      }),
    ),
    // Records written before findings existed have none.
    findings: Schema.optional(Schema.Array(ReverseFindingRecord)),
    captures: Schema.optional(Schema.Array(ReverseCapture)),
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
    const record = decode(value);
    return {
      ...record,
      findings: [...(record.findings ?? [])],
      captures: [...(record.captures ?? [])],
    } as ProjectRecord;
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
 * Copies a workspace file into content-addressed storage and returns its digest. The copy reads
 * one open handle that is checked to be the contained regular file, so swapping a path component
 * for a symlink after the check cannot redirect it, and a FIFO is refused instead of blocking.
 */
async function copyContained(input: {
  workspaceRoot: string;
  relativePath: string;
  destDir: string;
  maxBytes: number;
  noun: string;
}): Promise<{ sha256: string; sizeBytes: number }> {
  const { relativePath, noun } = input;
  if (
    NodePath.isAbsolute(relativePath) ||
    relativePath.includes("\0") ||
    relativePath.trim() === "" ||
    relativePath.split(/[\\/]/u).includes("..")
  )
    throw err("outside_workspace", "Select a relative path within the project workspace.");
  const limit = `${Math.round(input.maxBytes / 1024 / 1024)} MiB`;
  const root = await NodeFSP.realpath(input.workspaceRoot);
  const target = NodePath.resolve(root, relativePath);
  const real = await NodeFSP.realpath(target);
  if (!real.startsWith(root + NodePath.sep))
    throw err("outside_workspace", `${noun} file resolves outside the project workspace.`);
  await NodeFSP.mkdir(input.destDir, { recursive: true });
  const stagingPath = NodePath.join(input.destDir, `.${NodeCrypto.randomUUID()}.tmp`);
  const source = await NodeFSP.open(
    real,
    NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW | NodeFS.constants.O_NONBLOCK,
  ).catch(() => {
    throw err("invalid_file", `${noun} input must be a regular file.`);
  });
  try {
    const opened = await source.stat();
    if (!opened.isFile()) throw err("invalid_file", `${noun} input must be a regular file.`);
    if (opened.size > input.maxBytes)
      throw err("too_large", `${noun} input exceeds the ${limit} import limit.`);
    const current = await NodeFSP.realpath(target);
    const named = await NodeFSP.stat(current);
    if (current !== real || named.dev !== opened.dev || named.ino !== opened.ino)
      throw err("outside_workspace", `${noun} file changed while it was being imported.`);
    const hash = NodeCrypto.createHash("sha256");
    const staging = await NodeFSP.open(stagingPath, "wx", 0o600);
    let sizeBytes = 0;
    try {
      const buffer = Buffer.alloc(1024 * 1024);
      for (;;) {
        const { bytesRead } = await source.read(buffer, 0, buffer.length, sizeBytes);
        if (bytesRead === 0) break;
        sizeBytes += bytesRead;
        if (sizeBytes > input.maxBytes)
          throw err("too_large", `${noun} input exceeded the ${limit} import limit.`);
        const chunk = buffer.subarray(0, bytesRead);
        hash.update(chunk);
        await staging.write(chunk);
      }
    } finally {
      await staging.close();
    }
    const sha256 = hash.digest("hex");
    await NodeFSP.rename(stagingPath, NodePath.join(input.destDir, sha256));
    return { sha256, sizeBytes };
  } finally {
    await source.close();
    await NodeFSP.rm(stagingPath, { force: true }).catch(() => undefined);
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
    /** For firmware extracted from another investigation: its parent and a readable origin. */
    origin?: { parentInvestigationId: string; parentSha256: string; label: string };
  }): Promise<{ investigation: ReverseInvestigation; artifact: ReverseFirmwareArtifact }> {
    const { projectId, relativePath } = input;
    const { sha256, sizeBytes: copiedBytes } = await copyContained({
      workspaceRoot: input.workspaceRoot,
      relativePath,
      destDir: NodePath.join(this.stateDir, "reverse", "artifacts"),
      maxBytes: MAX_IMPORT_BYTES,
      noun: "Firmware",
    });
    {
      const artifact: ReverseFirmwareArtifact = {
        sha256,
        sizeBytes: copiedBytes,
        filename: NodePath.basename(relativePath),
        sourcePath: input.origin?.label ?? relativePath,
        importedAt: DateTime.formatIso(DateTime.nowUnsafe()),
        ...(input.origin ? { parentSha256: input.origin.parentSha256 } : {}),
      };
      return await this.locked(projectId, async () => {
        const record = await readProject(this.stateDir, projectId);
        const prior = record.investigations.find((x) => x.artifactSha256 === sha256);
        const investigation: ReverseInvestigation = prior ?? {
          id: NodeCrypto.randomUUID(),
          projectId,
          environmentId: input.environmentId,
          artifactSha256: sha256,
          ...(input.origin ? { parentInvestigationId: input.origin.parentInvestigationId } : {}),
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

  /**
   * Records a candidate finding. Evidence about code or a run must concern this investigation's
   * firmware, so a finding cannot quietly cite another artifact.
   */
  createFinding(input: {
    projectId: string;
    investigationId: string;
    title: string;
    kind: ReverseFindingRecord["kind"];
    evidence: ReverseFindingRecord["evidence"];
    authorKind: "human" | "agent";
  }): Promise<ReverseFindingRecord> {
    return this.locked(input.projectId, async () => {
      const record = await readProject(this.stateDir, input.projectId);
      const investigation = record.investigations.find((x) => x.id === input.investigationId);
      if (!investigation) throw err("not_found", "Investigation not found in this project.");
      const digest = investigation.artifactSha256;
      if (input.authorKind === "agent" && input.evidence.length === 0)
        throw err("invalid_file", "Agent findings must cite evidence a person can check.");
      for (const ref of input.evidence) {
        // A QEMU run must be one this environment recorded for this firmware.
        if (
          ref.kind === "execution" &&
          (ref.source !== "qemu" ||
            !(await this.emulationRecorded(input.projectId, ref.runId, digest)))
        )
          throw err("invalid_file", "Execution evidence must name a QEMU run of this firmware.");
        // A capture window must name a capture imported into this project.
        if (
          ref.kind === "capture" &&
          !(await readProject(this.stateDir, input.projectId)).captures.some(
            (capture) => capture.id === ref.captureId,
          )
        )
          throw err("invalid_file", "Capture evidence must name a capture in this project.");
        const cited =
          ref.kind === "code"
            ? ref.location.artifactSha256
            : ref.kind === "execution"
              ? ref.artifactSha256
              : digest;
        if (cited !== digest)
          throw err("invalid_file", "Evidence must refer to this investigation's firmware.");
      }
      const now = DateTime.formatIso(DateTime.nowUnsafe());
      const finding: ReverseFindingRecord = {
        id: NodeCrypto.randomUUID(),
        investigationId: investigation.id,
        artifactSha256: digest,
        title: input.title,
        kind: input.kind,
        status: "candidate",
        authorKind: input.authorKind,
        evidence: input.evidence,
        createdAt: now,
        updatedAt: now,
      };
      record.findings.push(finding);
      await saveProject(this.stateDir, input.projectId, record);
      return finding;
    });
  }

  private async emulationRecorded(projectId: string, runId: string, digest: string) {
    return (await this.emulationOutcome(projectId, runId, digest)) !== null;
  }

  /** The outcome of a QEMU run this environment recorded for this firmware, or null. */
  async emulationOutcome(
    projectId: string,
    runId: string,
    digest: string,
  ): Promise<"pass" | "fail" | "error" | "inconclusive" | null> {
    if (!/^[0-9a-f-]{36}$/.test(runId)) return null;
    const owner = NodeCrypto.createHash("sha256").update(projectId).digest("hex");
    const receipt = await NodeFSP.readFile(
      NodePath.join(this.stateDir, "reverse", "emulation", owner, runId, "receipt.json"),
      "utf8",
    ).catch(() => null);
    if (receipt === null) return null;
    const value = JSON.parse(receipt) as { artifactSha256?: unknown; outcome?: unknown };
    if (value.artifactSha256 !== digest) return null;
    return value.outcome === "pass" || value.outcome === "fail" || value.outcome === "error"
      ? value.outcome
      : "inconclusive";
  }

  /** Records that this firmware is registered in Veritas and which board revision was synced. */
  markRegistered(
    projectId: string,
    investigationId: string,
    veritasArtifactId: string,
    veritasBoardRevisionId: string | null,
  ) {
    return this.locked(projectId, async () => {
      const record = await readProject(this.stateDir, projectId);
      const index = record.investigations.findIndex((x) => x.id === investigationId);
      if (index < 0) return;
      record.investigations[index] = {
        ...record.investigations[index]!,
        veritasArtifactId,
        veritasBoardRevisionId,
      };
      await saveProject(this.stateDir, projectId, record);
    });
  }

  /** Records the Veritas id of a published finding. */
  markFindingPublished(projectId: string, findingId: string, veritasFindingId: string) {
    return this.locked(projectId, async () => {
      const record = await readProject(this.stateDir, projectId);
      const index = record.findings.findIndex((x) => x.id === findingId);
      if (index < 0) return;
      record.findings[index] = { ...record.findings[index]!, veritasFindingId };
      await saveProject(this.stateDir, projectId, record);
    });
  }

  async finding(projectId: string, findingId: string): Promise<ReverseFindingRecord> {
    const record = await readProject(this.stateDir, projectId);
    const finding = record.findings.find((x) => x.id === findingId);
    if (!finding) throw err("not_found", "Finding not found in this project.");
    return finding;
  }

  /** Humans set any status; agents may only reject or supersede, never promote. */
  updateFinding(input: {
    projectId: string;
    findingId: string;
    status: FindingStatus;
    actor: "human" | "agent";
  }): Promise<ReverseFindingRecord> {
    return this.locked(input.projectId, async () => {
      if (input.actor === "agent" && input.status !== "rejected" && input.status !== "superseded")
        throw err(
          "invalid_file",
          "Agents can reject or supersede findings; promoting or confirming one is up to a person.",
        );
      const record = await readProject(this.stateDir, input.projectId);
      const index = record.findings.findIndex((x) => x.id === input.findingId);
      if (index < 0) throw err("not_found", "Finding not found in this project.");
      const current = record.findings[index]!;
      // Agents may close open hypotheses, never overturn a decision a person made.
      if (
        input.actor === "agent" &&
        (current.statusChangedBy === "human" || current.status === "confirmed")
      )
        throw err("invalid_file", "A person decided this finding; only a person can change it.");
      const next: ReverseFindingRecord = {
        ...current,
        status: input.status,
        statusChangedBy: input.actor,
        updatedAt: DateTime.formatIso(DateTime.nowUnsafe()),
      };
      record.findings[index] = next;
      await saveProject(this.stateDir, input.projectId, record);
      return next;
    });
  }

  /** Remembers how Ghidra loaded this firmware, so other views open the same program. */
  rememberGhidraProfile(
    projectId: string,
    investigationId: string,
    profile: { languageId?: string | undefined; imageBase?: string | undefined },
  ): Promise<void> {
    return this.locked(projectId, async () => {
      const record = await readProject(this.stateDir, projectId);
      const index = record.investigations.findIndex((x) => x.id === investigationId);
      if (index < 0) return;
      const ghidraProfile = {
        ...(profile.languageId ? { languageId: profile.languageId } : {}),
        ...(profile.imageBase ? { imageBase: profile.imageBase } : {}),
      };
      record.investigations[index] = { ...record.investigations[index]!, ghidraProfile };
      await saveProject(this.stateDir, projectId, record);
    });
  }

  /** Removes an investigation; its firmware bytes go once no project references them. */
  async remove(projectId: string, investigationId: string): Promise<void> {
    await this.locked(projectId, async () => {
      const record = await readProject(this.stateDir, projectId);
      const investigation = record.investigations.find((x) => x.id === investigationId);
      if (!investigation) throw err("not_found", "Investigation not found in this project.");
      record.investigations = record.investigations.filter((x) => x.id !== investigationId);
      record.findings = record.findings.filter((x) => x.investigationId !== investigationId);
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
  /** Imports a logic-analyzer capture; it must parse before it is kept. */
  async importCapture(input: {
    projectId: string;
    workspaceRoot: string;
    relativePath: string;
  }): Promise<ReverseCapture> {
    const capturesDir = NodePath.join(this.stateDir, "reverse", "captures");
    const { sha256, sizeBytes } = await copyContained({
      workspaceRoot: input.workspaceRoot,
      relativePath: input.relativePath,
      destDir: capturesDir,
      maxBytes: MAX_CAPTURE_BYTES,
      noun: "Capture",
    });
    const filename = NodePath.basename(input.relativePath);
    const parsed = await this.parseStored(sha256, filename);
    return this.locked(input.projectId, async () => {
      const record = await readProject(this.stateDir, input.projectId);
      const prior = record.captures.find((capture) => capture.sha256 === sha256);
      if (prior) return prior;
      const capture: ReverseCapture = {
        id: NodeCrypto.randomUUID(),
        filename,
        sourcePath: input.relativePath,
        format: parsed.format,
        sha256,
        sizeBytes,
        importedAt: DateTime.formatIso(DateTime.nowUnsafe()),
        channels: parsed.channels.map((channel) => channel.name),
        durationNs: parsed.durationNs,
        sampleRateHz: parsed.sampleRateHz,
        truncated: parsed.truncated,
        skipped: parsed.skipped,
      };
      record.captures.push(capture);
      await saveProject(this.stateDir, input.projectId, record);
      return capture;
    });
  }

  /** The parsed signals of a capture in this project. */
  async capture(projectId: string, captureId: string): Promise<ParsedCapture> {
    const record = await readProject(this.stateDir, projectId);
    const capture = record.captures.find((item) => item.id === captureId);
    if (!capture) throw err("not_found", "Capture not found in this project.");
    return this.parseStored(capture.sha256, capture.filename);
  }

  // Parsing a large capture takes a while, so the most recent few stay in memory.
  private readonly parsedCaptures = new Map<string, Promise<ParsedCapture>>();
  private parseStored(sha256: string, filename: string): Promise<ParsedCapture> {
    const cached = this.parsedCaptures.get(sha256);
    if (cached) {
      this.parsedCaptures.delete(sha256);
      this.parsedCaptures.set(sha256, cached);
      return cached;
    }
    const oldest = this.parsedCaptures.keys().next();
    if (this.parsedCaptures.size >= PARSED_CAPTURE_CACHE && !oldest.done)
      this.parsedCaptures.delete(oldest.value);
    const parsing = NodeFSP.readFile(NodePath.join(this.stateDir, "reverse", "captures", sha256))
      .then((bytes) => parseCapture(new Uint8Array(bytes), filename))
      .catch((error: unknown) => {
        throw error instanceof CaptureFormatError ? err("invalid_file", error.message) : error;
      });
    this.parsedCaptures.set(sha256, parsing);
    parsing.catch(() => this.parsedCaptures.delete(sha256));
    return parsing;
  }

  /** Removes a capture; findings keep their citations, and its bytes go once nothing uses them. */
  async removeCapture(projectId: string, captureId: string): Promise<void> {
    await this.locked(projectId, async () => {
      const record = await readProject(this.stateDir, projectId);
      if (!record.captures.some((capture) => capture.id === captureId))
        throw err("not_found", "Capture not found in this project.");
      record.captures = record.captures.filter((capture) => capture.id !== captureId);
      await saveProject(this.stateDir, projectId, record);
    });
    await this.collectArtifacts().catch(() => undefined);
  }

  // Firmware and capture bytes nobody references are removed once past the grace period.
  private async collectArtifacts(): Promise<void> {
    const projects = NodePath.join(this.stateDir, "reverse", "projects");
    const referenced = new Set<string>();
    for (const name of await NodeFSP.readdir(projects).catch(() => [])) {
      if (!name.endsWith(".json")) continue;
      const value = decode(
        JSON.parse(await NodeFSP.readFile(NodePath.join(projects, name), "utf8")),
      );
      for (const artifact of value.artifacts) referenced.add(artifact.sha256);
      for (const capture of value.captures ?? []) referenced.add(capture.sha256);
    }
    for (const folder of ["artifacts", "captures"]) {
      const dir = NodePath.join(this.stateDir, "reverse", folder);
      for (const name of await NodeFSP.readdir(dir).catch(() => [])) {
        if (!/^[a-f0-9]{64}$/.test(name) || referenced.has(name)) continue;
        const full = NodePath.join(dir, name);
        const stat = await NodeFSP.stat(full).catch(() => null);
        if (stat && performance.timeOrigin + performance.now() - stat.mtimeMs > ARTIFACT_GRACE_MS)
          await NodeFSP.rm(full, { force: true });
      }
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
