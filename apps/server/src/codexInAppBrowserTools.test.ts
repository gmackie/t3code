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

  it("summarizes successful browser action responses with human-readable text", async () => {
    const client = {
      sendRequest: vi.fn(async () => ({
        message: 'Typed into textbox "Search"',
        url: "https://example.com/dashboard",
      })),
    };
    const handler = createCodexInAppBrowserDynamicToolHandler(client);

    const response = await handler({
      threadId: "thread-1",
      turnId: "turn-1",
      callId: "call-1",
      tool: "browser.type",
      arguments: {
        role: "textbox",
        name: "Search",
        text: "t3 code",
      },
    });

    expect(response).toEqual({
      contentItems: [
        {
          type: "inputText",
          text: 'Typed into textbox "Search"\nURL: https://example.com/dashboard',
        },
      ],
      success: true,
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

  it("maps semantic inspect target hints into a browser inspect request", async () => {
    const client = {
      sendRequest: vi.fn(async () => ({
        message: "Inspected current page.",
        url: "https://example.com/dashboard",
      })),
    };
    const handler = createCodexInAppBrowserDynamicToolHandler(client);

    await expect(
      handler({
        threadId: "thread-1",
        turnId: "turn-1",
        callId: "call-1",
        tool: "browser.inspect",
        arguments: {
          role: "button",
          name: "Continue",
          index: 1,
        },
      }),
    ).resolves.toMatchObject({
      success: true,
    });

    expect(client.sendRequest).toHaveBeenCalledWith({
      type: "inspect",
      threadId: "thread-1",
      target: {
        role: "button",
        name: "Continue",
        index: 1,
      },
    });
  });

  it("maps inspect text target hints into a browser inspect request", async () => {
    const client = {
      sendRequest: vi.fn(async () => ({
        message: "Inspected current page.",
        url: "https://example.com/dashboard",
      })),
    };
    const handler = createCodexInAppBrowserDynamicToolHandler(client);

    await expect(
      handler({
        threadId: "thread-1",
        turnId: "turn-1",
        callId: "call-1",
        tool: "browser.inspect",
        arguments: {
          text: "Continue to dashboard",
        },
      }),
    ).resolves.toMatchObject({
      success: true,
    });

    expect(client.sendRequest).toHaveBeenCalledWith({
      type: "inspect",
      threadId: "thread-1",
      target: {
        text: "Continue to dashboard",
      },
    });
  });

  it("summarizes browser inspect results in readable QA-oriented text", async () => {
    const client = {
      sendRequest: vi.fn(async () => ({
        message: "Inspected current page.",
        url: "https://example.com/dashboard",
        title: "Dashboard",
        loadingState: "complete" as const,
        elements: [
          {
            role: "button",
            name: "Continue",
            text: "Continue",
          },
        ],
      })),
    };
    const handler = createCodexInAppBrowserDynamicToolHandler(client);

    await expect(
      handler({
        threadId: "thread-1",
        turnId: "turn-1",
        callId: "call-1",
        tool: "browser.inspect",
        arguments: {},
      }),
    ).resolves.toEqual({
      contentItems: [
        {
          type: "inputText",
          text: expect.stringContaining("Page: Dashboard"),
        },
      ],
      success: true,
    });

    const response = await handler({
      threadId: "thread-1",
      turnId: "turn-1",
      callId: "call-2",
      tool: "browser.inspect",
      arguments: {},
    });

    expect(response.contentItems[0]).toMatchObject({
      type: "inputText",
      text: expect.stringContaining('Elements: button "Continue"'),
    });
  });

  it("summarizes browser diagnostics results with page errors and counts", async () => {
    const client = {
      sendRequest: vi.fn(async () => ({
        message: "Collected browser diagnostics.",
        url: "https://example.com/dashboard",
        title: "Dashboard",
        loadingState: "interactive" as const,
        lastError: "Page crashed while loading app shell",
        consoleMessages: ["console exploded"],
        networkErrors: ["GET https://example.com/api failed with 500"],
      })),
    };
    const handler = createCodexInAppBrowserDynamicToolHandler(client);

    const response = await handler({
      threadId: "thread-1",
      turnId: "turn-1",
      callId: "call-1",
      tool: "browser.diagnostics",
      arguments: {},
    });

    expect(response).toMatchObject({
      contentItems: [
        {
          type: "inputText",
          text: expect.stringContaining("Last error: Page crashed while loading app shell"),
        },
      ],
      success: true,
    });
    expect(response.contentItems[0]).toMatchObject({
      type: "inputText",
      text: expect.stringContaining("Console messages: 1"),
    });
  });

  it("summarizes browser screenshot results while preserving the image attachment", async () => {
    const client = {
      sendRequest: vi.fn(async () => ({
        message: "Captured browser screenshot.",
        title: "Dashboard",
        url: "https://example.com/dashboard",
        screenshotDataUrl: "data:image/png;base64,AAAA",
      })),
    };
    const handler = createCodexInAppBrowserDynamicToolHandler(client);

    const response = await handler({
      threadId: "thread-1",
      turnId: "turn-1",
      callId: "call-1",
      tool: "browser.screenshot",
      arguments: {},
    });

    expect(response).toEqual({
      contentItems: [
        {
          type: "inputText",
          text: "Captured browser screenshot.\nPage: Dashboard\nURL: https://example.com/dashboard",
        },
        {
          type: "inputImage",
          imageUrl: "data:image/png;base64,AAAA",
        },
      ],
      success: true,
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
          text: expect.stringContaining("Failure: Element not found"),
        },
        {
          type: "inputImage",
          imageUrl: "data:image/png;base64,AAAA",
        },
      ],
      success: false,
    });
  });

  it("summarizes browser failures with page context and diagnostics counts", async () => {
    const client = {
      sendRequest: vi.fn(async () => ({
        message: "Click failed: Element not found",
        error: "Element not found",
        title: "Dashboard",
        url: "https://example.com/dashboard",
        loadingState: "interactive" as const,
        lastError: "Page crashed while loading app shell",
        consoleMessages: ["console exploded"],
        networkErrors: ["GET https://example.com/api failed with 500"],
        screenshotDataUrl: "data:image/png;base64,AAAA",
      })),
    };
    const handler = createCodexInAppBrowserDynamicToolHandler(client);

    const response = await handler({
      threadId: "thread-1",
      turnId: "turn-1",
      callId: "call-1",
      tool: "browser.click",
      arguments: {
        selector: "#missing",
      },
    });

    expect(response).toMatchObject({
      contentItems: [
        {
          type: "inputText",
          text: expect.stringContaining("Page: Dashboard"),
        },
        {
          type: "inputImage",
          imageUrl: "data:image/png;base64,AAAA",
        },
      ],
      success: false,
    });
    expect(response.contentItems[0]).toMatchObject({
      type: "inputText",
      text: expect.stringContaining("Console messages: 1"),
    });
  });
});
