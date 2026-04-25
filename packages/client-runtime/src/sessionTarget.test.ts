import { describe, expect, it } from "vitest";

import { httpToWsBaseUrl, resolveSessionTarget, wsToHttpBaseUrl } from "./sessionTarget.ts";

describe("sessionTarget", () => {
  it("converts http urls into websocket base urls", () => {
    expect(httpToWsBaseUrl("http://100.88.12.4:3773/pair#token=pairing-token")).toBe(
      "ws://100.88.12.4:3773/",
    );
    expect(httpToWsBaseUrl("https://remote.example.com/deep/path?x=1#y")).toBe(
      "wss://remote.example.com/",
    );
  });

  it("converts websocket urls into http base urls", () => {
    expect(wsToHttpBaseUrl("ws://100.88.12.4:3773/ws?token=abc")).toBe("http://100.88.12.4:3773/");
    expect(wsToHttpBaseUrl("wss://remote.example.com/ws")).toBe("https://remote.example.com/");
  });

  it("preserves explicit non-http schemes instead of rewriting them", () => {
    expect(resolveSessionTarget("ftp://remote.example.com/some/path")).toEqual({
      httpBaseUrl: "ftp://remote.example.com/",
      wsBaseUrl: "ftp://remote.example.com/",
    });
  });

  it("defaults bare hosts to https and derives wss", () => {
    expect(resolveSessionTarget("remote.example.com:3773")).toEqual({
      httpBaseUrl: "https://remote.example.com:3773/",
      wsBaseUrl: "wss://remote.example.com:3773/",
    });
  });

  it("rejects empty backend urls", () => {
    expect(() => resolveSessionTarget("   ")).toThrow("Enter a backend URL.");
  });
});
