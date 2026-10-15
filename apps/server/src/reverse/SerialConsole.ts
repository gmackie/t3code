// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - serial devices are host TTYs opened directly.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeTty from "node:tty";
import { ReverseStoreError } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

export const SERIAL_BAUD_RATES = [
  1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600,
] as const;

const PORT_PATTERNS: Record<string, RegExp> = {
  // The cu.* side does not wait for carrier detect, which is what a console wants.
  darwin: /^cu\.(?!Bluetooth-Incoming-Port).+$/,
  linux: /^tty(USB|ACM|AMA)\d+$/,
};
const MAX_BUFFER_BYTES = 512 * 1024;
const MAX_TRANSCRIPT_BYTES = 16 * 1024 * 1024;
const MAX_WRITE_BYTES = 4096;

const failure = (reason: ReverseStoreError["reason"], message: string) =>
  new ReverseStoreError({ reason, message });

/** Serial devices on this host, by path. Only these can be opened. */
export async function listSerialPorts(
  platform: NodeJS.Platform,
  devDir = "/dev",
): Promise<string[]> {
  const pattern = PORT_PATTERNS[platform];
  if (!pattern) return [];
  const names = await NodeFSP.readdir(devDir).catch(() => []);
  return names
    .filter((name) => pattern.test(name))
    .sort()
    .map((name) => NodePath.join(devDir, name));
}

export interface SerialChunk {
  seq: number;
  /** Bytes as base64, so binary protocols survive the trip. */
  data: string;
}

/**
 * The output side of one session: a bounded buffer that late subscribers replay from a
 * sequence number, plus live listeners. Kept apart from the device so it can be tested.
 */
export class SerialOutput {
  private readonly chunks: Array<{ seq: number; bytes: Buffer }> = [];
  private buffered = 0;
  private seq = 0;
  private readonly listeners = new Set<(chunk: SerialChunk) => void>();
  push(bytes: Buffer): void {
    const chunk = { seq: ++this.seq, bytes };
    this.chunks.push(chunk);
    this.buffered += bytes.length;
    while (this.buffered > MAX_BUFFER_BYTES && this.chunks.length > 1)
      this.buffered -= this.chunks.shift()!.bytes.length;
    const event = { seq: chunk.seq, data: bytes.toString("base64") };
    for (const listener of this.listeners) listener(event);
  }
  /** Replays what is still buffered after `afterSeq`, then follows live output. */
  observe(afterSeq: number, listener: (chunk: SerialChunk) => void): () => void {
    for (const chunk of this.chunks)
      if (chunk.seq > afterSeq) listener({ seq: chunk.seq, data: chunk.bytes.toString("base64") });
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  /** The most recent buffered output, oldest first, at most `maxBytes`. */
  recent(maxBytes: number): Buffer {
    const parts: Buffer[] = [];
    let size = 0;
    for (let index = this.chunks.length - 1; index >= 0 && size < maxBytes; index--) {
      parts.unshift(this.chunks[index]!.bytes);
      size += this.chunks[index]!.bytes.length;
    }
    const joined = Buffer.concat(parts);
    return joined.subarray(Math.max(0, joined.length - maxBytes));
  }
  get lastSeq(): number {
    return this.seq;
  }
}

export interface SerialSessionInfo {
  id: string;
  port: string;
  baud: number;
  openedAt: string;
}

interface Session {
  info: SerialSessionInfo;
  projectId: string;
  output: SerialOutput;
  stream: NodeTty.ReadStream;
  fd: number;
  transcript: NodeFS.WriteStream;
  transcriptBytes: number;
}

/** Applies raw 8N1 settings at a baud rate; BSD stty takes -f, GNU stty -F. */
function configure(platform: NodeJS.Platform, port: string, baud: number): Promise<void> {
  const flag = platform === "darwin" ? "-f" : "-F";
  return new Promise((resolve, reject) => {
    NodeChildProcess.execFile(
      "stty",
      [flag, port, String(baud), "raw", "-echo", "cs8", "-cstopb", "-parenb", "clocal"],
      { timeout: 5000 },
      (error) =>
        error
          ? reject(
              failure("unavailable", `Could not configure ${port}. Is it in use or unplugged?`),
            )
          : resolve(),
    );
  });
}

/** Serial consoles held by this environment, one per port. */
export class SerialConsole {
  private readonly sessions = new Map<string, Session>();
  private readonly stateDir: string;
  private readonly platform: NodeJS.Platform;
  constructor(stateDir: string, platform: NodeJS.Platform) {
    this.stateDir = stateDir;
    this.platform = platform;
  }

  ports(): Promise<string[]> {
    return listSerialPorts(this.platform);
  }

  list(projectId: string): SerialSessionInfo[] {
    return [...this.sessions.values()]
      .filter((session) => session.projectId === projectId)
      .map((session) => session.info);
  }

  async open(projectId: string, port: string, baud: number): Promise<SerialSessionInfo> {
    if (!PORT_PATTERNS[this.platform])
      throw failure("unavailable", "Serial consoles are supported on macOS and Linux hosts.");
    if (!(await this.ports()).includes(port))
      throw failure("not_found", `${port} is not a serial port on this environment.`);
    if (!(SERIAL_BAUD_RATES as readonly number[]).includes(baud))
      throw failure("invalid_file", `Unsupported baud rate ${baud}.`);
    if ([...this.sessions.values()].some((session) => session.info.port === port))
      throw failure("unavailable", `${port} is already open.`);
    await configure(this.platform, port, baud);
    const fd = NodeFS.openSync(
      port,
      NodeFS.constants.O_RDWR | NodeFS.constants.O_NOCTTY | NodeFS.constants.O_NONBLOCK,
    );
    if (!NodeTty.isatty(fd)) {
      NodeFS.closeSync(fd);
      throw failure("invalid_file", `${port} is not a terminal device.`);
    }
    const info: SerialSessionInfo = {
      id: NodeCrypto.randomUUID(),
      port,
      baud,
      openedAt: DateTime.formatIso(DateTime.nowUnsafe()),
    };
    const owner = NodeCrypto.createHash("sha256").update(projectId).digest("hex");
    const transcriptDir = NodePath.join(this.stateDir, "reverse", "serial", owner);
    await NodeFSP.mkdir(transcriptDir, { recursive: true, mode: 0o700 });
    const session: Session = {
      info,
      projectId,
      output: new SerialOutput(),
      stream: new NodeTty.ReadStream(fd),
      fd,
      transcript: NodeFS.createWriteStream(NodePath.join(transcriptDir, `${info.id}.log`), {
        mode: 0o600,
      }),
      transcriptBytes: 0,
    };
    session.stream.on("data", (bytes: Buffer) => {
      session.output.push(bytes);
      if (session.transcriptBytes < MAX_TRANSCRIPT_BYTES) {
        session.transcript.write(bytes);
        session.transcriptBytes += bytes.length;
      }
    });
    // An unplugged adapter ends the stream; the session closes with it.
    session.stream.on("error", () => this.close(info.id));
    session.stream.on("end", () => this.close(info.id));
    this.sessions.set(info.id, session);
    return info;
  }

  private session(sessionId: string, projectId: string): Session {
    const session = this.sessions.get(sessionId);
    if (!session || session.projectId !== projectId)
      throw failure("not_found", "That serial session is not open.");
    return session;
  }

  observe(
    projectId: string,
    sessionId: string,
    afterSeq: number,
    listener: (chunk: SerialChunk) => void,
  ): () => void {
    return this.session(sessionId, projectId).output.observe(afterSeq, listener);
  }

  recent(
    projectId: string,
    sessionId: string,
    maxBytes: number,
  ): { text: string; lastSeq: number } {
    const session = this.session(sessionId, projectId);
    return {
      text: session.output.recent(maxBytes).toString("utf8"),
      lastSeq: session.output.lastSeq,
    };
  }

  async write(projectId: string, sessionId: string, bytes: Buffer): Promise<void> {
    const session = this.session(sessionId, projectId);
    if (bytes.length === 0 || bytes.length > MAX_WRITE_BYTES)
      throw failure("invalid_file", `Send between 1 byte and ${MAX_WRITE_BYTES} bytes at a time.`);
    let offset = 0;
    while (offset < bytes.length) {
      const written = await new Promise<number>((resolve, reject) =>
        NodeFS.write(session.fd, bytes, offset, bytes.length - offset, null, (error, count) => {
          // A full output buffer on a non-blocking device: wait a tick and continue.
          if (error && (error as NodeJS.ErrnoException).code === "EAGAIN") resolve(0);
          else if (error)
            reject(failure("operation_failed", `Writing to ${session.info.port} failed.`));
          else resolve(count);
        }),
      );
      if (written === 0) await new Promise((resolve) => setTimeout(resolve, 5));
      offset += written;
    }
  }

  close(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    session.stream.destroy();
    session.transcript.end();
    // ReadStream owns the descriptor and closes it on destroy.
  }

  closeFor(projectId: string, sessionId: string): void {
    this.session(sessionId, projectId);
    this.close(sessionId);
  }

  dispose(): void {
    for (const id of [...this.sessions.keys()]) this.close(id);
  }
}
