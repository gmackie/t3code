// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - the line protocol is promise code outside the Effect runtime.
import * as NodeStringDecoder from "node:string_decoder";
import { launchTool, type ToolInput } from "./ToolRunner.ts";
type Pending = {
  method: string;
  payload: string;
  timeoutMs: number;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
};
/**
 * Persistent framed protocol; ordinary Ghidra log lines never become RPC replies.
 * The bridge answers one request at a time, so requests are written one at a time
 * and each timeout covers only that request's own work, not time spent queued.
 */
export class JsonLineProcess {
  private readonly launch: ReturnType<typeof launchTool>;
  private readonly pending = new Map<string, Pending>();
  private readonly queue: string[] = [];
  private inFlight: string | null = null;
  private readonly prefix: string;
  private nextId = 0;
  private buffer = "";
  private stopped = false;
  private diagnostic = "";
  constructor(input: ToolInput, prefix = "@T3RE:") {
    this.prefix = prefix;
    this.launch = launchTool(input);
    const decoder = new NodeStringDecoder.StringDecoder("utf8");
    this.launch.child.stdout.on("data", (chunk: Buffer) => {
      this.buffer += decoder.write(chunk);
      if (Buffer.byteLength(this.buffer) > 8 * 1024 * 1024) {
        this.fail(new Error("Bridge response exceeded limit"));
        return;
      }
      let newline: number;
      while ((newline = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, newline).replace(/\r$/, "");
        this.buffer = this.buffer.slice(newline + 1);
        if (!line.startsWith(this.prefix)) {
          this.diagnostic = (this.diagnostic + line + "\n").slice(-8192);
          continue;
        }
        try {
          const message = JSON.parse(line.slice(this.prefix.length));
          if (!message || typeof message.id !== "string")
            throw new Error("Invalid bridge envelope");
          const item = this.pending.get(message.id);
          if (!item) continue;
          this.pending.delete(message.id);
          clearTimeout(item.timer);
          if (this.inFlight === message.id) this.inFlight = null;
          if (message.error) item.reject(new Error(String(message.error)));
          else item.resolve(message.result);
          this.pump();
        } catch (error) {
          this.fail(error instanceof Error ? error : new Error(String(error)));
        }
      }
    });
    this.launch.child.stderr.on("data", (chunk: Buffer) => {
      this.diagnostic = (this.diagnostic + chunk.toString("utf8")).slice(-8192);
    });
    this.launch.child.stdin.on("error", (error) => this.fail(error));
    this.launch.child.once("error", (error) => this.fail(error));
    this.launch.child.once("close", (code) =>
      this.fail(new Error(`Bridge exited (${code}): ${this.diagnostic.slice(-2048)}`)),
    );
  }
  request(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 60_000,
  ): Promise<unknown> {
    if (this.stopped)
      return Promise.reject(
        new Error("Bridge is closed; reopen the session before issuing another command"),
      );
    if (this.pending.size >= 16) return Promise.reject(new Error("Bridge request queue is full"));
    const id = String(++this.nextId);
    const payload = JSON.stringify({ id, method, params });
    if (Buffer.byteLength(payload) > 65536)
      return Promise.reject(new Error("Bridge request too large"));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { method, payload, timeoutMs, resolve, reject });
      this.queue.push(id);
      this.pump();
    });
  }
  private pump(): void {
    if (this.stopped || this.inFlight !== null) return;
    const id = this.queue.shift();
    const item = id === undefined ? undefined : this.pending.get(id);
    if (id === undefined || !item) return;
    this.inFlight = id;
    item.timer = setTimeout(
      () =>
        this.fail(
          new Error(
            `Bridge ${item.method} timed out; mutation outcome may be unknown. No automatic retry.`,
          ),
        ),
      item.timeoutMs,
    );
    this.launch.child.stdin.write(item.payload + "\n");
  }
  /** True while a request is queued or awaiting its reply. */
  isBusy(): boolean {
    return this.pending.size > 0;
  }
  isClosed(): boolean {
    return this.stopped;
  }
  close(): void {
    this.fail(new Error("Bridge closed"));
  }
  private fail(error: Error): void {
    if (this.stopped) return;
    this.stopped = true;
    this.launch.terminate();
    for (const item of this.pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    this.pending.clear();
    this.queue.length = 0;
  }
}
