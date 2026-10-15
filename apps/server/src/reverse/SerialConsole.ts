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
  private ended = false;
  private readonly listeners = new Set<{ chunk: (chunk: SerialChunk) => void; end: () => void }>();
  push(bytes: Buffer): void {
    if (this.ended) return;
    const chunk = { seq: ++this.seq, bytes };
    this.chunks.push(chunk);
    this.buffered += bytes.length;
    while (this.buffered > MAX_BUFFER_BYTES && this.chunks.length > 1)
      this.buffered -= this.chunks.shift()!.bytes.length;
    const event = { seq: chunk.seq, data: bytes.toString("base64") };
    for (const listener of this.listeners) listener.chunk(event);
  }
  /** Replays what is still buffered after `afterSeq` as one chunk, then follows live output. */
  observe(afterSeq: number, onChunk: (chunk: SerialChunk) => void, onEnd: () => void): () => void {
    const missed = this.chunks.filter((chunk) => chunk.seq > afterSeq);
    if (missed.length)
      onChunk({
        seq: missed.at(-1)!.seq,
        data: Buffer.concat(missed.map((c) => c.bytes)).toString("base64"),
      });
    if (this.ended) {
      onEnd();
      return () => undefined;
    }
    const listener = { chunk: onChunk, end: onEnd };
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  /** Ends every observer; nothing more arrives after the session closes. */
  end(): void {
    if (this.ended) return;
    this.ended = true;
    for (const listener of this.listeners) listener.end();
    this.listeners.clear();
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
  closed: boolean;
  // Serial reads arrive a few bytes at a time; they are batched briefly before buffering.
  pending: Buffer[];
  flush: ReturnType<typeof setTimeout> | null;
  writing: Promise<void> | null;
}

const BATCH_MS = 20;
const WRITE_DEADLINE_MS = 10_000;

/**
 * Applies raw 8N1, no flow control, at a baud rate. stty acts on its standard input, so it
 * configures the descriptor the server already holds instead of opening and closing the port,
 * which would drop DTR and reset many boards.
 */
function configure(fd: number, port: string, baud: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = NodeChildProcess.spawn(
      "stty",
      [String(baud), "raw", "-echo", "cs8", "-cstopb", "-parenb", "clocal", "-crtscts"],
      { stdio: [fd, "ignore", "ignore"], timeout: 5000 },
    );
    const fail = () =>
      reject(failure("unavailable", `Could not configure ${port}. Is it in use or unplugged?`));
    child.on("error", fail);
    child.on("exit", (code) => (code === 0 ? resolve() : fail()));
  });
}

/** Serial consoles held by this environment, one per port. */
export class SerialConsole {
  private readonly sessions = new Map<string, Session>();
  // Ports being opened, reserved before the first await so two opens cannot both win.
  private readonly opening = new Set<string>();
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

  /** Projects that currently hold a session. */
  owners(): string[] {
    return [...new Set([...this.sessions.values()].map((session) => session.projectId))];
  }

  async open(projectId: string, port: string, baud: number): Promise<SerialSessionInfo> {
    if (!PORT_PATTERNS[this.platform])
      throw failure("unavailable", "Serial consoles are supported on macOS and Linux hosts.");
    if (!(SERIAL_BAUD_RATES as readonly number[]).includes(baud))
      throw failure("invalid_file", `Unsupported baud rate ${baud}.`);
    if (this.opening.has(port) || [...this.sessions.values()].some((s) => s.info.port === port))
      throw failure("unavailable", `${port} is already open.`);
    this.opening.add(port);
    try {
      if (!(await this.ports()).includes(port))
        throw failure("not_found", `${port} is not a serial port on this environment.`);
      const fd = NodeFS.openSync(
        port,
        NodeFS.constants.O_RDWR | NodeFS.constants.O_NOCTTY | NodeFS.constants.O_NONBLOCK,
      );
      let stream: NodeTty.ReadStream | null = null;
      try {
        if (!NodeTty.isatty(fd)) throw failure("invalid_file", `${port} is not a terminal device.`);
        await configure(fd, port, baud);
        const info: SerialSessionInfo = {
          id: NodeCrypto.randomUUID(),
          port,
          baud,
          openedAt: DateTime.formatIso(DateTime.nowUnsafe()),
        };
        const owner = NodeCrypto.createHash("sha256").update(projectId).digest("hex");
        const transcriptDir = NodePath.join(this.stateDir, "reverse", "serial", owner);
        await NodeFSP.mkdir(transcriptDir, { recursive: true, mode: 0o700 });
        stream = new NodeTty.ReadStream(fd);
        const transcript = NodeFS.createWriteStream(
          NodePath.join(transcriptDir, `${info.id}.log`),
          { mode: 0o600 },
        );
        const session: Session = {
          info,
          projectId,
          output: new SerialOutput(),
          stream,
          fd,
          transcript,
          transcriptBytes: 0,
          closed: false,
          pending: [],
          flush: null,
          writing: null,
        };
        // A full disk or I/O error stops the transcript; the console itself keeps going.
        transcript.on("error", () => {
          session.transcriptBytes = MAX_TRANSCRIPT_BYTES;
        });
        stream.on("data", (bytes: Buffer) => {
          session.pending.push(bytes);
          session.flush ??= setTimeout(() => this.flushPending(session), BATCH_MS);
        });
        // An unplugged adapter ends the stream; the session closes with it.
        stream.on("error", () => this.close(info.id));
        stream.on("end", () => this.close(info.id));
        this.sessions.set(info.id, session);
        return info;
      } catch (error) {
        // The descriptor belongs to the stream once one exists.
        if (stream) stream.destroy();
        else NodeFS.closeSync(fd);
        throw error;
      }
    } finally {
      this.opening.delete(port);
    }
  }

  private flushPending(session: Session): void {
    session.flush = null;
    if (session.pending.length === 0) return;
    const bytes = Buffer.concat(session.pending);
    session.pending = [];
    session.output.push(bytes);
    if (session.transcriptBytes < MAX_TRANSCRIPT_BYTES) {
      session.transcript.write(bytes);
      session.transcriptBytes += bytes.length;
    }
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
    onChunk: (chunk: SerialChunk) => void,
    onEnd: () => void,
  ): () => void {
    return this.session(sessionId, projectId).output.observe(afterSeq, onChunk, onEnd);
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

  write(projectId: string, sessionId: string, bytes: Buffer): Promise<void> {
    const session = this.session(sessionId, projectId);
    if (bytes.length === 0 || bytes.length > MAX_WRITE_BYTES)
      throw failure("invalid_file", `Send between 1 byte and ${MAX_WRITE_BYTES} bytes at a time.`);
    if (session.writing) throw failure("unavailable", "Wait for the previous send to finish.");
    const writing = this.writeAll(session, bytes).finally(() => {
      session.writing = null;
    });
    session.writing = writing;
    return writing;
  }

  private async writeAll(session: Session, bytes: Buffer): Promise<void> {
    const deadline = performance.now() + WRITE_DEADLINE_MS;
    let offset = 0;
    while (offset < bytes.length) {
      // Never write after close: the descriptor number may already belong to another file.
      if (session.closed) throw failure("unavailable", `${session.info.port} was closed.`);
      const written = await new Promise<number>((resolve, reject) =>
        NodeFS.write(session.fd, bytes, offset, bytes.length - offset, null, (error, count) => {
          if (error && (error as NodeJS.ErrnoException).code === "EAGAIN") resolve(0);
          else if (error)
            reject(failure("operation_failed", `Writing to ${session.info.port} failed.`));
          else resolve(count);
        }),
      );
      if (written === 0) {
        if (performance.now() > deadline)
          throw failure("unavailable", `${session.info.port} is not accepting output.`);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      offset += written;
    }
  }

  close(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    session.closed = true;
    if (session.flush) clearTimeout(session.flush);
    this.flushPending(session);
    session.output.end();
    session.transcript.end();
    // The stream owns the descriptor; it closes only after any write in flight has stopped.
    void (session.writing ?? Promise.resolve())
      .catch(() => undefined)
      .finally(() => session.stream.destroy());
  }

  closeFor(projectId: string, sessionId: string): void {
    this.session(sessionId, projectId);
    this.close(sessionId);
  }

  /** Closes every session a project holds, such as after the project is deleted. */
  closeProject(projectId: string): void {
    for (const session of this.sessions.values())
      if (session.projectId === projectId) this.close(session.info.id);
  }

  dispose(): void {
    for (const id of this.sessions.keys()) this.close(id);
  }
}
