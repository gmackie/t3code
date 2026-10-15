// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - Ghidra sessions are promise code outside the Effect runtime.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeCrypto from "node:crypto";
import { JsonLineProcess } from "./JsonLineProcess.ts";
import { runBoundedTool } from "./ToolRunner.ts";
export interface GhidraProfile {
  languageId?: string | undefined;
  imageBase?: string | undefined;
}
export interface GhidraOperation extends GhidraProfile {
  action?: "list" | "function" | "rename" | "comment" | "save" | "close" | undefined;
  address?: string | undefined;
  name?: string | undefined;
  expectedName?: string | undefined;
  comment?: string | undefined;
  cursor?: number | undefined;
}
export interface GhidraToken {
  text: string;
  address?: string;
  syntaxType: number;
}
export interface GhidraFunction {
  address: string;
  name: string;
  pseudocode: string;
  instructions: { address: string; text: string; bytes?: string }[];
  tokens?: GhidraToken[];
  callees?: { address: string; name: string }[];
  xrefs?: { address: string; type: string }[];
}
export interface GhidraReply {
  functions: GhidraFunction[];
  truncated: boolean;
  toolVersion: string;
  nextCursor?: number;
}
/** Each open program has one persistent JVM. Project/profile/version participate in identity. */
export class GhidraSessionPool {
  // Aborted on dispose so an import still running dies with the server.
  private imports = new AbortController();
  private readonly sessions = new Map<
    string,
    { opening: Promise<JsonLineProcess>; idle: ReturnType<typeof setTimeout> }
  >();
  private readonly directory: string;
  constructor(directory: string) {
    this.directory = directory;
  }
  async execute(
    projectId: string,
    artifactPath: string,
    digest: string,
    operation: GhidraOperation = {},
  ): Promise<GhidraReply> {
    const install = process.env.GHIDRA_INSTALL_DIR,
      scripts = process.env.T3_REVERSE_GHIDRA_SCRIPTS;
    if (!install || !scripts || !NodePath.isAbsolute(install) || !NodePath.isAbsolute(scripts))
      throw new Error(
        "Configure absolute GHIDRA_INSTALL_DIR and T3_REVERSE_GHIDRA_SCRIPTS paths on the environment host.",
      );
    // oxlint-disable-next-line t3code/no-global-process-runtime -- promise code outside the Effect runtime.
    if (process.platform === "win32")
      throw new Error(
        "Persistent Ghidra requires a Linux/macOS analysis host; the Windows client can connect remotely.",
      );
    const properties = await NodeFSP.readFile(
      NodePath.join(install, "Ghidra", "application.properties"),
      "utf8",
    );
    const version = /^application.version=(.+)$/m.exec(properties)?.[1]?.trim();
    if (!version) throw new Error("Cannot identify the installed Ghidra version");
    const profile = {
      languageId: operation.languageId ?? null,
      imageBase: operation.imageBase ?? null,
      version,
    };
    const key = NodeCrypto.createHash("sha256")
      .update(JSON.stringify([projectId, digest, profile]))
      .digest("hex");
    const cwd = NodePath.join(this.directory, key),
      executable = NodePath.join(install, "support", "analyzeHeadless");
    const action = operation.action ?? "list";
    if (
      ["function", "rename", "comment"].includes(action) &&
      !/^0x[0-9a-f]+$/i.test(operation.address ?? "")
    )
      throw new Error("A hexadecimal function address is required");
    if (
      action === "rename" &&
      (!operation.name ||
        !/^[A-Za-z_$][A-Za-z0-9_.$]{0,127}$/.test(operation.name) ||
        !operation.expectedName)
    )
      throw new Error("Rename requires a valid name and expected current name");
    if (
      action === "comment" &&
      (operation.comment === undefined || operation.comment.length > 8192)
    )
      throw new Error("Comment must be at most 8192 characters");
    let session = this.sessions.get(key);
    // Closing a program that is not open must not import it first.
    if (!session && action === "close")
      return { functions: [], truncated: false, toolVersion: version };
    if (!session) {
      if (this.sessions.size >= 4)
        throw new Error("Four Ghidra programs are open. Close one before opening another.");
      const opening = this.open(cwd, executable, scripts, artifactPath, profile);
      session = { opening, idle: setTimeout(() => this.close(key), 600000) };
      this.sessions.set(key, session);
      void opening.catch(() => {
        if (this.sessions.get(key)?.opening === opening) this.close(key);
      });
    }
    clearTimeout(session.idle);
    session.idle = setTimeout(() => this.close(key), 600000);
    session.idle.unref();
    const bridge = await session.opening;
    if (bridge.isClosed()) {
      this.close(key);
      throw new Error(
        "Ghidra worker exited. Reopen analysis; interrupted edits are never replayed.",
      );
    }
    const reply = await bridge.request(action, {
      address: operation.address,
      name: operation.name,
      expectedName: operation.expectedName,
      comment: operation.comment,
      cursor: operation.cursor ?? 0,
      limit: 128,
    });
    if (action === "close") this.close(key);
    if (!reply || typeof reply !== "object") throw new Error("Invalid Ghidra response");
    const value = reply as Partial<GhidraReply>;
    if (!Array.isArray(value.functions) || typeof value.truncated !== "boolean")
      throw new Error("Malformed Ghidra result");
    return {
      ...value,
      functions: value.functions,
      truncated: value.truncated,
      toolVersion: version,
    };
  }
  private async open(
    cwd: string,
    executable: string,
    scripts: string,
    artifact: string,
    profile: { languageId: string | null; imageBase: string | null; version: string },
  ): Promise<JsonLineProcess> {
    await NodeFSP.mkdir(cwd, { recursive: true, mode: 0o700 });
    const projectDir = NodePath.join(cwd, "project"),
      manifest = NodePath.join(cwd, "imported.json");
    await NodeFSP.mkdir(projectDir, { recursive: true, mode: 0o700 });
    let imported = false;
    try {
      imported =
        JSON.stringify(JSON.parse(await NodeFSP.readFile(manifest, "utf8"))) ===
        JSON.stringify(profile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (!imported) {
      const args = [
        projectDir,
        "Firmware",
        "-import",
        artifact,
        "-analysisTimeoutPerFile",
        "120",
        "-max-cpu",
        "1",
      ];
      if (profile.languageId || profile.imageBase) {
        if (
          !profile.languageId ||
          !/^[A-Za-z0-9_.:-]{1,160}$/.test(profile.languageId) ||
          !profile.imageBase ||
          !/^0x[0-9a-f]+$/i.test(profile.imageBase)
        )
          throw new Error("Raw imports require a Ghidra language ID and hexadecimal image base");
        args.push(
          "-loader",
          "BinaryLoader",
          "-processor",
          profile.languageId,
          "-loader-baseAddr",
          profile.imageBase,
        );
      }
      const result = await runBoundedTool({
        executable,
        args,
        cwd,
        timeoutMs: 180000,
        sandbox: true,
        signal: this.imports.signal,
      });
      if (result.exitCode !== 0 || result.timedOut || result.truncated)
        throw new Error(
          `Ghidra import did not finish: ${result.stderr.slice(-2048)} ${result.stdout.slice(-2048)}`,
        );
      await NodeFSP.writeFile(manifest, JSON.stringify(profile), { mode: 0o600 });
    }
    const bridge = new JsonLineProcess({
      executable,
      args: [
        projectDir,
        "Firmware",
        "-process",
        NodePath.basename(artifact),
        "-noanalysis",
        "-scriptPath",
        scripts,
        "-postScript",
        "ReverseBridge.java",
      ],
      cwd,
      sandbox: true,
    });
    try {
      await bridge.request("ping", {}, 90000);
      return bridge;
    } catch (error) {
      bridge.close();
      throw error;
    }
  }
  private close(key: string): void {
    const session = this.sessions.get(key);
    if (!session) return;
    clearTimeout(session.idle);
    this.sessions.delete(key);
    void session.opening.then(
      (bridge) => bridge.close(),
      () => undefined,
    );
  }
  dispose(): void {
    this.imports.abort(new Error("Ghidra session pool disposed"));
    this.imports = new AbortController();
    for (const key of [...this.sessions.keys()]) this.close(key);
  }
}
const pools = new Map<string, GhidraSessionPool>();
export function ghidraSessions(stateDir: string): GhidraSessionPool {
  let pool = pools.get(stateDir);
  if (!pool) {
    pool = new GhidraSessionPool(NodePath.join(stateDir, "reverse", "ghidra"));
    pools.set(stateDir, pool);
  }
  return pool;
}
