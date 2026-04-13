import "../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { createBrowserTab } from "../browser";
import BrowserPanel from "./BrowserPanel";

describe("BrowserPanel", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("shows the latest inspect and diagnostics evidence for the active browser thread", async () => {
    const tab = { ...createBrowserTab("https://example.com/dashboard"), id: "tab-1" };
    const host = document.createElement("div");
    document.body.append(host);

    const screen = await render(
      <BrowserPanel
        state={{ activeTabId: tab.id, tabs: [tab] }}
        activeTab={tab}
        automationState={{ status: "agent", tabId: tab.id, message: "Codex controlling browser" }}
        latestEvidence={{
          toolName: "browser.diagnostics",
          capturedAt: "2026-04-13T12:00:00.000Z",
          url: "https://example.com/dashboard",
          title: "Dashboard",
          loadingState: "interactive",
          lastError: "Page crashed while loading app shell",
          consoleMessages: ["console exploded"],
          networkErrors: ["GET https://example.com/api failed with 500"],
          screenshotDataUrl: "data:image/png;base64,AAAA",
          elements: [
            {
              role: "button",
              name: "Continue",
              text: "Continue",
            },
          ],
        }}
        inputValue="https://example.com/dashboard"
        focusRequestId={0}
        onInputChange={() => {}}
        onCreateTab={() => {}}
        onActivateTab={() => {}}
        onCloseTab={() => {}}
        onSubmit={() => {}}
        onBack={() => {}}
        onForward={() => {}}
        onReload={() => {}}
        onOpenExternal={() => {}}
      />,
      { container: host },
    );

    try {
      await expect.element(page.getByText("Latest browser evidence")).toBeInTheDocument();
      await expect.element(page.getByText("Dashboard")).toBeInTheDocument();
      await expect.element(page.getByText("Loading: interactive")).toBeInTheDocument();
      await expect.element(page.getByText("console exploded")).toBeInTheDocument();
      await expect
        .element(page.getByText("GET https://example.com/api failed with 500"))
        .toBeInTheDocument();
      await expect
        .element(page.getByAltText("Latest browser evidence screenshot"))
        .toBeInTheDocument();
    } finally {
      await screen.unmount();
      host.remove();
    }
  });
});
