// @effect-diagnostics nodeBuiltinImport:off - Stands in for an Electron debugger.
import { describe, expect, it } from "@effect/vitest";
import { DesktopBrowserEvent } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as NodeEvents from "node:events";

import * as DesktopBrowserHost from "./DesktopBrowserHost.ts";

const decodeEvent = Schema.decodeUnknownSync(Schema.fromJsonString(DesktopBrowserEvent));
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeCdpReply = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ id: Schema.Number })),
);
const key = { threadId: "thread-1", tabId: "tab-1" };

/** A tab's webContents and debugger, with the debugger's commands left pending until released. */
const makeDebuggee = () => {
  const emitter = new NodeEvents.EventEmitter();
  const pending: Array<() => void> = [];
  const debuggee = Object.assign(emitter, {
    sendCommand: (method: string) =>
      new Promise((resolve) => {
        if (method === "Runtime.disable") {
          resolve({});
          return;
        }
        if (method === "Target.getTargetInfo") {
          resolve({ targetInfo: { targetId: "GUEST" } });
          return;
        }
        pending.push(() => resolve({ method }));
        emitter.emit("command", method);
      }),
  });
  const webContents = {
    getURL: () => "http://localhost/",
    getTitle: () => "Page",
    getUserAgent: () => "Electron",
  };
  return {
    tab: {
      webContents: webContents as unknown as Electron.WebContents,
      debugger: debuggee as unknown as Electron.Debugger,
    },
    nextCommand: () => new Promise<void>((resolve) => emitter.once("command", () => resolve())),
    emit: (method: string, params: unknown) => emitter.emit("message", {}, method, params, ""),
    release: () => pending.splice(0).forEach((resolve) => resolve()),
  };
};

/** Reads `count` events from one backend's subscription. */
const takeEvents = (host: DesktopBrowserHost.DesktopBrowserHost["Service"], count: number) =>
  host.events.pipe(
    Stream.take(count),
    Stream.runCollect,
    Effect.map((lines) => lines.map((line) => decodeEvent(new TextDecoder().decode(line)))),
  );

describe("DesktopBrowserHost", () => {
  it.effect("announces tabs already attached to a backend that starts later", () =>
    Effect.gen(function* () {
      const host = yield* DesktopBrowserHost.make;
      host.attach(key, makeDebuggee().tab);
      // A restarted backend subscribes after the attach and still hears it.
      expect(yield* takeEvents(host, 1)).toEqual([{ type: "attached", ...key }]);
      expect(yield* takeEvents(host, 1)).toEqual([{ type: "attached", ...key }]);
    }),
  );

  it.effect("drops replies from a relay the server released", () =>
    Effect.gen(function* () {
      const host = yield* DesktopBrowserHost.make;
      const debuggee = makeDebuggee();
      host.attach(key, debuggee.tab);
      const reader = yield* takeEvents(host, 2).pipe(Effect.forkScoped);
      // Wait until the reader has received the announcement.
      yield* Effect.yieldNow;
      const command = (id: number, method: string) =>
        host.handleCommandLine(
          encodeJson({
            type: "cdp",
            ...key,
            message: encodeJson({ id, method, sessionId: "t3-preview-page" }),
          }),
        );
      yield* command(1, "Page.captureScreenshot");
      yield* host.handleCommandLine(encodeJson({ type: "release", ...key }));
      const sent = debuggee.nextCommand();
      yield* command(2, "DOM.enable");
      yield* Effect.promise(() => sent);
      debuggee.release();
      yield* Effect.promise(() => new Promise((resolve) => setImmediate(resolve)));
      const [, reply] = yield* Fiber.join(reader);
      // Only the new connection's reply arrives; the old one's id could collide.
      expect(reply).toMatchObject({ type: "cdp" });
      expect(decodeCdpReply((reply as { message: string }).message).id).toBe(2);
    }).pipe(Effect.scoped),
  );

  it.effect(
    "replays execution contexts when Playwright reconnects to an already-enabled Runtime",
    () =>
      Effect.gen(function* () {
        const host = yield* DesktopBrowserHost.make;
        const events = new NodeEvents.EventEmitter();
        let enabled = true;
        const debuggerWithRuntime = Object.assign(events, {
          async sendCommand(method: string) {
            if (method === "Target.getTargetInfo") return { targetInfo: { targetId: "GUEST" } };
            if (method === "Runtime.disable") enabled = false;
            if (method === "Runtime.enable" && !enabled) {
              enabled = true;
              events.emit(
                "message",
                {},
                "Runtime.executionContextCreated",
                { context: { id: 1 } },
                "",
              );
            }
            return {};
          },
        });
        host.attach(key, {
          ...makeDebuggee().tab,
          debugger: debuggerWithRuntime as unknown as Electron.Debugger,
        });
        const connect = Effect.gen(function* () {
          const reading = yield* takeEvents(host, 5).pipe(Effect.forkScoped);
          yield* Effect.yieldNow;
          yield* host.handleCommandLine(
            encodeJson({
              type: "cdp",
              ...key,
              message: encodeJson({ id: 1, method: "Target.setAutoAttach" }),
            }),
          );
          yield* host.handleCommandLine(
            encodeJson({
              type: "cdp",
              ...key,
              message: encodeJson({
                id: 2,
                method: "Runtime.enable",
                sessionId: "t3-preview-page",
              }),
            }),
          );
          const received = yield* Fiber.join(reading);
          return received
            .filter((event) => event.type === "cdp")
            .map((event) => JSON.parse(event.message));
        });
        expect(yield* connect).toContainEqual(
          expect.objectContaining({ method: "Runtime.executionContextCreated" }),
        );
        yield* host.handleCommandLine(encodeJson({ type: "release", ...key }));
        expect(yield* connect).toContainEqual(
          expect.objectContaining({ method: "Runtime.executionContextCreated" }),
        );
      }).pipe(Effect.scoped),
  );

  it.effect("saves a server tab's download under its CDP guid where the server asked", () =>
    Effect.gen(function* () {
      const host = yield* DesktopBrowserHost.make;
      const debuggee = makeDebuggee();
      host.attach(key, debuggee.tab);
      const paths: Array<string> = [];
      const item = {
        setSavePath: (path: string) => void paths.push(path),
      } as unknown as Electron.DownloadItem;
      // Before the server sets a directory, Electron keeps its own handling.
      expect(host.placeDownload(debuggee.tab.webContents, item)).toBe(false);
      yield* host.handleCommandLine(
        encodeJson({
          type: "cdp",
          ...key,
          message: encodeJson({
            id: 1,
            method: "Browser.setDownloadBehavior",
            params: { behavior: "allowAndName", downloadPath: "/srv/downloads" },
          }),
        }),
      );
      debuggee.emit("Browser.downloadWillBegin", { guid: "guid-1", suggestedFilename: "r.csv" });
      expect(host.placeDownload(debuggee.tab.webContents, item)).toBe(true);
      expect(paths).toEqual(["/srv/downloads/guid-1"]);
    }),
  );

  it.effect("tells a download the person clicked from one the agent's input started", () =>
    Effect.gen(function* () {
      const host = yield* DesktopBrowserHost.make;
      const debuggee = makeDebuggee();
      host.attach(key, debuggee.tab);
      // Reading the page is not acting on it.
      yield* host.handleCommandLine(
        encodeJson({
          type: "cdp",
          ...key,
          message: encodeJson({ id: 1, method: "DOM.getDocument", params: {} }),
        }),
      );
      expect(host.humanStartedDownload(debuggee.tab.webContents)).toBe(true);
      yield* host.handleCommandLine(
        encodeJson({
          type: "cdp",
          ...key,
          message: encodeJson({
            id: 2,
            method: "Input.dispatchMouseEvent",
            params: { type: "mousePressed", x: 1, y: 1 },
          }),
        }),
      );
      expect(host.humanStartedDownload(debuggee.tab.webContents)).toBe(false);
    }),
  );
});
