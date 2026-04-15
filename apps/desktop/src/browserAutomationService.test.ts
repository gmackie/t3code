import { describe, expect, it, vi } from "vitest";

import { createBrowserAutomationService } from "./browserAutomationService";
import type { BrowserManager } from "./browserManager";

function createBrowserManagerStub(): BrowserManager {
  return {
    ensureTab: vi.fn(async () => {}),
    claimAutomationControl: vi.fn(() => {}),
    navigate: vi.fn(async () => {}),
    click: vi.fn(async () => {}),
    typeText: vi.fn(async () => {}),
    wait: vi.fn(async () => {}),
    inspect: vi.fn(async () => ({
      url: "https://example.com",
      title: "Example",
      text: "Example page",
      loadingState: "complete" as const,
      elements: [
        {
          role: "button",
          name: "Continue",
          text: "Continue",
          disabled: false,
        },
      ],
    })),
    screenshot: vi.fn(async () => "data:image/png;base64,AAAA"),
    diagnostics: vi.fn(async () => ({
      url: "https://example.com",
      title: "Example",
      loadingState: "interactive" as const,
      lastError: "Page crashed while loading app shell",
      consoleMessages: ["console exploded"],
      networkErrors: ["GET https://example.com/api failed with 500"],
    })),
    goBack: vi.fn(async () => {}),
    goForward: vi.fn(async () => {}),
    reload: vi.fn(async () => {}),
    closeTab: vi.fn(async () => {}),
    syncHost: vi.fn(() => {}),
    clearThread: vi.fn(() => {}),
    destroyAll: vi.fn(() => {}),
  };
}

describe("createBrowserAutomationService", () => {
  it("passes semantic click targets through to the browser manager", async () => {
    const browserManager = createBrowserManagerStub();
    const service = createBrowserAutomationService(browserManager);
    vi.mocked(browserManager.diagnostics).mockResolvedValueOnce({
      url: "https://example.com/dashboard",
      title: "Dashboard",
      loadingState: "complete",
      lastError: null,
      consoleMessages: [],
      networkErrors: [],
    });

    await expect(
      service.handleRequest({
        type: "click",
        threadId: "thread-1",
        target: {
          role: "button",
          name: "Continue",
          index: 1,
        },
      } as any),
    ).resolves.toMatchObject({
      message: 'Clicked button "Continue"',
      url: "https://example.com/dashboard",
      title: "Dashboard",
      loadingState: "complete",
    });

    expect(browserManager.click).toHaveBeenCalledWith({
      threadId: expect.anything(),
      tabId: "codex-browser",
      target: {
        role: "button",
        name: "Continue",
        index: 1,
      },
    });
  });

  it("passes clear typing requests through to the browser manager", async () => {
    const browserManager = createBrowserManagerStub();
    const service = createBrowserAutomationService(browserManager);

    await expect(
      service.handleRequest({
        type: "type",
        threadId: "thread-1",
        target: {
          role: "textbox",
          name: "Search",
        },
        text: "t3 code",
        clear: true,
      } as any),
    ).resolves.toMatchObject({
      message: 'Typed into textbox "Search"',
    });

    expect(browserManager.typeText).toHaveBeenCalledWith({
      threadId: expect.anything(),
      tabId: "codex-browser",
      target: {
        role: "textbox",
        name: "Search",
      },
      text: "t3 code",
      clear: true,
    });
  });

  it("passes url and title wait predicates through to the browser manager", async () => {
    const browserManager = createBrowserManagerStub();
    const service = createBrowserAutomationService(browserManager);
    vi.mocked(browserManager.diagnostics).mockResolvedValueOnce({
      url: "https://example.com/dashboard",
      title: "Dashboard",
      loadingState: "interactive",
      lastError: null,
      consoleMessages: [],
      networkErrors: [],
    });

    await expect(
      service.handleRequest({
        type: "wait",
        threadId: "thread-1",
        urlIncludes: "/dashboard",
        titleIncludes: "Dashboard",
        timeoutMs: 2500,
      } as any),
    ).resolves.toMatchObject({
      message: "Wait condition satisfied.",
      url: "https://example.com/dashboard",
      title: "Dashboard",
      loadingState: "interactive",
    });

    expect(browserManager.wait).toHaveBeenCalledWith({
      threadId: expect.anything(),
      tabId: "codex-browser",
      urlIncludes: "/dashboard",
      titleIncludes: "Dashboard",
      timeoutMs: 2500,
    });
  });

  it("passes semantic wait target hints through to the browser manager", async () => {
    const browserManager = createBrowserManagerStub();
    const service = createBrowserAutomationService(browserManager);

    await expect(
      service.handleRequest({
        type: "wait",
        threadId: "thread-1",
        target: {
          role: "button",
          name: "Continue",
          index: 1,
        },
        timeoutMs: 2500,
      } as any),
    ).resolves.toMatchObject({
      message: "Wait condition satisfied.",
    });

    expect(browserManager.wait).toHaveBeenCalledWith({
      threadId: expect.anything(),
      tabId: "codex-browser",
      target: {
        role: "button",
        name: "Continue",
        index: 1,
      },
      timeoutMs: 2500,
    });
  });

  it("passes semantic inspect targets through to the browser manager and returns structured elements", async () => {
    const browserManager = createBrowserManagerStub();
    const service = createBrowserAutomationService(browserManager);

    await expect(
      service.handleRequest({
        type: "inspect",
        threadId: "thread-1",
        target: {
          role: "button",
          name: "Continue",
          index: 1,
        },
      } as any),
    ).resolves.toMatchObject({
      message: "Inspected current page.",
      loadingState: "complete",
      elements: [
        {
          role: "button",
          name: "Continue",
          text: "Continue",
          disabled: false,
        },
      ],
    });

    expect(browserManager.inspect).toHaveBeenCalledWith({
      threadId: expect.anything(),
      tabId: "codex-browser",
      target: {
        role: "button",
        name: "Continue",
        index: 1,
      },
    });
  });

  it("returns richer page-state details for diagnostics requests", async () => {
    const browserManager = createBrowserManagerStub();
    const service = createBrowserAutomationService(browserManager);

    await expect(
      service.handleRequest({
        type: "diagnostics",
        threadId: "thread-1",
      } as any),
    ).resolves.toMatchObject({
      message: "Collected browser diagnostics.",
      url: "https://example.com",
      title: "Example",
      loadingState: "interactive",
      lastError: "Page crashed while loading app shell",
      consoleMessages: ["console exploded"],
      networkErrors: ["GET https://example.com/api failed with 500"],
    });
  });

  it("returns current page context after successful navigation", async () => {
    const browserManager = createBrowserManagerStub();
    const service = createBrowserAutomationService(browserManager);
    vi.mocked(browserManager.diagnostics).mockResolvedValueOnce({
      url: "https://example.com/dashboard",
      title: "Dashboard",
      loadingState: "interactive",
      lastError: null,
      consoleMessages: [],
      networkErrors: [],
    });

    await expect(
      service.handleRequest({
        type: "navigate",
        threadId: "thread-1",
        url: "https://example.com/dashboard",
      } as any),
    ).resolves.toMatchObject({
      message: "Navigated to https://example.com/dashboard",
      url: "https://example.com/dashboard",
      title: "Dashboard",
      loadingState: "interactive",
    });
  });

  it("returns screenshot and diagnostics context when an action fails", async () => {
    const browserManager = createBrowserManagerStub();
    vi.mocked(browserManager.click).mockRejectedValueOnce(new Error("Element not found"));
    const service = createBrowserAutomationService(browserManager);

    await expect(
      service.handleRequest({
        type: "click",
        threadId: "thread-1",
        target: {
          selector: "#missing",
        },
      }),
    ).resolves.toMatchObject({
      message: "Click failed: Element not found",
      error: "Element not found",
      url: "https://example.com",
      title: "Example",
      consoleMessages: ["console exploded"],
      networkErrors: ["GET https://example.com/api failed with 500"],
      screenshotDataUrl: "data:image/png;base64,AAAA",
    });
  });
});
