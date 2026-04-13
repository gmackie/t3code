import { describe, expect, it, vi } from "vitest";

import { createCodexInAppBrowserDynamicToolHandler } from "./codexInAppBrowserTools";

describe("createCodexInAppBrowserDynamicToolHandler", () => {
  it("maps semantic click arguments into a browser target request", async () => {
    const client = {
      sendRequest: vi.fn(async () => ({
        message: "Clicked button",
      })),
    };
    const handler = createCodexInAppBrowserDynamicToolHandler(client);

    await expect(
      handler({
        threadId: "thread-1",
        turnId: "turn-1",
        callId: "call-1",
        tool: "browser.click",
        arguments: {
          role: "button",
          name: "Continue",
          index: 2,
        },
      }),
    ).resolves.toMatchObject({
      success: true,
    });

    expect(client.sendRequest).toHaveBeenCalledWith({
      type: "click",
      threadId: "thread-1",
      target: {
        role: "button",
        name: "Continue",
        index: 2,
      },
    });
  });

  it("maps semantic type arguments including clear into a browser target request", async () => {
    const client = {
      sendRequest: vi.fn(async () => ({
        message: "Typed into textbox",
      })),
    };
    const handler = createCodexInAppBrowserDynamicToolHandler(client);

    await expect(
      handler({
        threadId: "thread-1",
        turnId: "turn-1",
        callId: "call-1",
        tool: "browser.type",
        arguments: {
          role: "textbox",
          name: "Search",
          text: "t3 code",
          clear: true,
        },
      }),
    ).resolves.toMatchObject({
      success: true,
    });

    expect(client.sendRequest).toHaveBeenCalledWith({
      type: "type",
      threadId: "thread-1",
      target: {
        role: "textbox",
        name: "Search",
      },
      text: "t3 code",
      clear: true,
    });
  });

  it("maps wait url and title predicates into a browser wait request", async () => {
    const client = {
      sendRequest: vi.fn(async () => ({
        message: "Wait condition satisfied.",
      })),
    };
    const handler = createCodexInAppBrowserDynamicToolHandler(client);

    await expect(
      handler({
        threadId: "thread-1",
        turnId: "turn-1",
        callId: "call-1",
        tool: "browser.wait",
        arguments: {
          urlIncludes: "/dashboard",
          titleIncludes: "Dashboard",
          timeoutMs: 2500,
        },
      }),
    ).resolves.toMatchObject({
      success: true,
    });

    expect(client.sendRequest).toHaveBeenCalledWith({
      type: "wait",
      threadId: "thread-1",
      urlIncludes: "/dashboard",
      titleIncludes: "Dashboard",
      timeoutMs: 2500,
    });
  });

  it("maps semantic wait target hints into a browser wait request", async () => {
    const client = {
      sendRequest: vi.fn(async () => ({
        message: "Wait condition satisfied.",
      })),
    };
    const handler = createCodexInAppBrowserDynamicToolHandler(client);

    await expect(
      handler({
        threadId: "thread-1",
        turnId: "turn-1",
        callId: "call-1",
        tool: "browser.wait",
        arguments: {
          role: "button",
          name: "Continue",
          index: 1,
          timeoutMs: 2500,
        },
      }),
    ).resolves.toMatchObject({
      success: true,
    });

    expect(client.sendRequest).toHaveBeenCalledWith({
      type: "wait",
      threadId: "thread-1",
      target: {
        role: "button",
        name: "Continue",
        index: 1,
      },
      timeoutMs: 2500,
    });
  });

  it("keeps enriched browser failures as failed tool results and preserves screenshots", async () => {
    const client = {
      sendRequest: vi.fn(async () => ({
        message: "Click failed: Element not found",
        error: "Element not found",
        url: "https://example.com",
        screenshotDataUrl: "data:image/png;base64,AAAA",
        consoleMessages: ["console exploded"],
        networkErrors: ["GET https://example.com/api failed with 500"],
      })),
    };
    const handler = createCodexInAppBrowserDynamicToolHandler(client);

    await expect(
      handler({
        threadId: "thread-1",
        turnId: "turn-1",
        callId: "call-1",
        tool: "browser.click",
        arguments: {
          selector: "#missing",
        },
      }),
    ).resolves.toEqual({
      contentItems: [
        {
          type: "inputText",
          text: expect.stringContaining('"error": "Element not found"'),
        },
        {
          type: "inputImage",
          imageUrl: "data:image/png;base64,AAAA",
        },
      ],
      success: false,
    });
  });
});
