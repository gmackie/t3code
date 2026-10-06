import * as NodeVM from "node:vm";
import { expect, it } from "vite-plus/test";
import { gameViewerDocument } from "./viewer.ts";

it("pauses frames and releases input on native background, resuming without reacquiring control", async () => {
  const listeners = new Map<string, (event?: { detail: boolean }) => void>();
  const elements = new Map<string, Record<string, unknown>>();
  const requests: string[] = [];
  const timers: Array<() => Promise<void>> = [];
  const element = (id: string) => {
    if (!elements.has(id))
      elements.set(id, {
        value: id === "kind" ? "editor" : "/fixture",
        textContent: "",
        replaceChildren() {},
        removeAttribute() {},
        focus() {},
      });
    return elements.get(id)!;
  };
  const context = {
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
    setInterval: () => 1,
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
