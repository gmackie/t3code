import * as NodeVM from "node:vm";
import { expect, it } from "vite-plus/test";
import { gameViewerDocument } from "./viewer.ts";

it("pauses frames and releases input on native background, resuming without reacquiring control", async () => {
  const listeners = new Map<string, (event?: { detail: boolean }) => void>();
  const elements = new Map<string, Record<string, unknown>>();
  const requests: string[] = [];
  const packets: Record<string, unknown>[] = [];
  let heartbeat: () => Promise<void> = async () => {};
  const pad = {
    connected: true,
    mapping: "standard",
    axes: [0.5, -0.25, 0.03, -0.75],
    buttons: Array.from({ length: 16 }, (_, i) => ({ pressed: i === 0, value: i === 6 ? 0.4 : 0 })),
  };
  let connected = true;
  const timers: Array<() => Promise<void>> = [];
  const element = (id: string) => {
    if (!elements.has(id))
      elements.set(id, {
        value: id === "kind" ? "editor" : "/fixture",
        textContent: "",
        style: {},
        replaceChildren() {},
        removeAttribute() {},
        focus() {},
      });
    return elements.get(id)!;
  };
  const context = {
    navigator: { getGamepads: () => (connected ? [pad] : []) },
    document: {
      hidden: false,
      getElementById: element,
      querySelectorAll: () => [],
      addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
    },
    window: {
      addEventListener: (name: string, callback: () => void) => listeners.set(name, callback),
    },
    location: {
      hash: "#ticket=test",
      pathname: "/api/game/viewer",
      href: "https://test/api/game/viewer",
    },
    history: { replaceState() {} },
    URL: class extends URL {
      static override createObjectURL() {
        return "blob:frame";
      }
      static override revokeObjectURL() {}
    },
    URLSearchParams,
    AbortSignal,
    setInterval: (callback: () => Promise<void>) => {
      heartbeat = callback;
      return 1;
    },
    clearInterval() {},
    setTimeout: (callback: () => Promise<void>) => {
      timers.push(callback);
      return timers.length;
    },
    clearTimeout() {},
    fetch: async (url: URL, options: { body?: string }) => {
      const action = options.body
        ? JSON.parse(options.body).action
        : url.pathname.split("/").at(-1);
      requests.push(action);
      if (options.body) packets.push(JSON.parse(options.body));
      const data =
        action === "config"
          ? { canOperate: true, cwd: "/fixture" }
          : action === "open"
            ? { sessionId: "session", catalog: { hooks: [], generation: "g" } }
            : action === "acquire"
              ? { lease: "lease" }
              : action === "state"
                ? { generation: "g", controller: {}, monitor: null }
                : {};
      return { ok: true, json: async () => data, blob: async () => new Blob([]) };
    },
  };
  NodeVM.runInNewContext(gameViewerDocument.split("<script>")[1]!.split("</script>")[0]!, context);
  // Drain asynchronous initialization without wall-clock sleeps.
  const drain = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  await drain();
  await (element("open").onclick as () => Promise<void>)();
  await drain();
  await (element("take").onclick as () => Promise<void>)();
  expect(element("owner").textContent).toBe("You control input");
  element("useGamepad").checked = true;
  await heartbeat();
  expect(packets.at(-1)?.gamepad).toEqual({
    leftX: 0.5,
    leftY: 0.25,
    rightX: 0,
    rightY: 0.75,
    leftTrigger: 0.4,
    rightTrigger: 0,
    buttons: ["South"],
  });
  connected = false;
  await heartbeat();
  expect(packets.at(-1)).not.toHaveProperty("gamepad");
  listeners.get("t3-game-visibility")!({ detail: false });
  await drain();
  expect(requests).toContain("release");
  expect(element("owner").textContent).toBe("Viewing only");
  const framesBefore = requests.filter((action) => action === "session").length;
  const pending = timers.splice(0);
  for (const callback of pending) await callback();
  expect(requests.filter((action) => action === "session")).toHaveLength(framesBefore);
  listeners.get("t3-game-visibility")!({ detail: true });
  const resumed = timers.splice(0);
  for (const callback of resumed) await callback();
  expect(requests.filter((action) => action === "session")).toHaveLength(framesBefore + 1);
  expect(requests.filter((action) => action === "acquire")).toHaveLength(1);
});

it("decodes VideoToolbox SPS headers and closes frames on background", async () => {
  const elements = new Map<string, Record<string, unknown>>();
  const listeners = new Map<string, (event: { detail: boolean }) => void>();
  const pending: Array<() => void> = [];
  const chunks: unknown[] = [];
  const configs: unknown[] = [];
  let closed = 0;
  let decoderClosed = false;
  const element = (id: string) => {
    if (!elements.has(id))
      elements.set(id, {
        value: id === "kind" ? "editor" : "/fixture",
        style: {},
        textContent: "",
        replaceChildren() {},
        removeAttribute() {},
        getContext: () => ({ drawImage() {} }),
      });
    return elements.get(id)!;
  };
  // Actual VideoToolbox SPS: nal_ref_idc=1 (0x27), not the often-seen 0x67.
  const packet = Uint8Array.from([
    0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0x27, 0x42, 0, 0x1f, 0xab, 0x40,
  ]);
  class Decoder {
    state = "configured";
    decodeQueueSize = 0;
    readonly callbacks: { output: (frame: unknown) => void };
    constructor(callbacks: { output: (frame: unknown) => void }) {
      this.callbacks = callbacks;
    }
    static async isConfigSupported(config: unknown) {
      configs.push(config);
      return { supported: true };
    }
    configure() {}
    decode(chunk: unknown) {
      chunks.push(chunk);
      this.callbacks.output({
        displayWidth: 1280,
        displayHeight: 720,
        close() {
          closed++;
        },
      });
    }
    close() {
      decoderClosed = true;
      this.state = "closed";
    }
  }
  const context = {
    document: {
      hidden: false,
      getElementById: element,
      querySelectorAll: () => [],
      addEventListener: (name: string, callback: (event: { detail: boolean }) => void) =>
        listeners.set(name, callback),
    },
    window: {
      addEventListener: (name: string, callback: (event: { detail: boolean }) => void) =>
        listeners.set(name, callback),
    },
    history: { replaceState() {} },
    location: {
      hash: "#ticket=test",
      pathname: "/api/game/viewer",
      href: "https://test/api/game/viewer",
    },
    URL,
    URLSearchParams,
    AbortSignal,
    VideoDecoder: Decoder,
    EncodedVideoChunk: class {
      readonly data: unknown;
      constructor(data: unknown) {
        this.data = data;
      }
    },
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: (callback: () => void) => {
      pending.push(callback);
      return 1;
    },
    clearTimeout() {},
    queueMicrotask: (callback: () => void) => pending.push(callback),
    fetch: async (_url: URL, options: { body?: string }) => ({
      ok: true,
      arrayBuffer: async () => packet.buffer,
      json: async () => {
        if (!options.body) return { canOperate: true, cwd: "/fixture" };
        const action = JSON.parse(options.body).action;
        return action === "open"
          ? { sessionId: "s", catalog: { generation: "g", hooks: [] } }
          : action === "state"
            ? { generation: "g", controller: {}, monitor: null }
            : {};
      },
    }),
  };
  NodeVM.runInNewContext(gameViewerDocument.split("<script>")[1]!.split("</script>")[0]!, context);
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await (element("open").onclick as () => Promise<void>)();
  for (let i = 0; i < 30; i++) await Promise.resolve();
  expect(configs).toContainEqual({ codec: "avc1.42001f", optimizeForLatency: true });
  expect(chunks).toHaveLength(1);
  expect(element("video").style).toMatchObject({ display: "block" });
  expect(closed).toBe(1);
  listeners.get("t3-game-visibility")!({ detail: false });
  expect(decoderClosed).toBe(true);
  expect(element("video").style).toMatchObject({ display: "none" });
});
