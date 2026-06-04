import "../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import BrowserCookieManager from "./BrowserCookieManager";

describe("BrowserCookieManager", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("lets the user filter cookie domains, import a selected source domain, and remove imported cookies by domain", async () => {
    const onSourceChange = vi.fn();
    const onProfileChange = vi.fn();
    const onSearchChange = vi.fn();
    const onImportDomain = vi.fn();
    const onRemoveDomain = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);

    const screen = await render(
      <BrowserCookieManager
        availableSources={[{ id: "chrome", label: "Chrome" }]}
        selectedSourceId="chrome"
        availableProfiles={[{ id: "Default", label: "Personal" }]}
        selectedProfileId="Default"
        sourceSearch="git"
        sourceDomains={[
          { domain: ".github.com", count: 2 },
          { domain: ".google.com", count: 4 },
        ]}
        sessionCookies={[
          {
            domain: ".github.com",
            name: "session_id",
            value: "secret",
            path: "/",
            secure: true,
            httpOnly: true,
            sameSite: "Lax",
            expirationLabel: "Session",
            removalUrl: "https://github.com/",
          },
        ]}
        isLoadingSources={false}
        isLoadingDomains={false}
        isImporting={false}
        isRemoving={false}
        onSourceChange={onSourceChange}
        onProfileChange={onProfileChange}
        onSearchChange={onSearchChange}
        onImportDomain={onImportDomain}
        onRemoveDomain={onRemoveDomain}
      />,
      { container: host },
    );

    try {
      await expect.element(page.getByText("Manage cookies")).toBeInTheDocument();
      await expect
        .element(page.getByLabelText("Import cookies for .github.com"))
        .toBeInTheDocument();
      await expect.element(page.getByText("session_id")).toBeInTheDocument();

      const searchInput = page.getByLabelText("Search source domains");
      await searchInput.fill("auth");
      expect(onSearchChange).toHaveBeenLastCalledWith("auth");

      await page.getByLabelText("Import cookies for .github.com").click();
      expect(onImportDomain).toHaveBeenCalledWith(".github.com");

      await page.getByLabelText("Remove imported cookies for .github.com").click();
      expect(onRemoveDomain).toHaveBeenCalledWith(".github.com");
    } finally {
      await screen.unmount();
      host.remove();
    }
  });
});
