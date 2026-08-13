import { describe, expect, it } from "vite-plus/test";

import { resolveSidebarFooterNavigation } from "./SidebarChrome";

describe("resolveSidebarFooterNavigation", () => {
  it("keeps Projects, Usage, and Settings available from the left navigation", () => {
    expect(
      resolveSidebarFooterNavigation({ currentPage: null, pullRequestsSupported: false }),
    ).toEqual(["projects", "usage", "settings"]);
  });

  it("keeps pull requests as an additional navigation surface", () => {
    expect(
      resolveSidebarFooterNavigation({ currentPage: null, pullRequestsSupported: true }),
    ).toEqual(["projects", "usage", "pull-requests", "settings"]);
  });

  it("does not hide the navigation when one of its destinations is active", () => {
    expect(
      resolveSidebarFooterNavigation({ currentPage: "usage", pullRequestsSupported: false }),
    ).toEqual(["projects", "usage", "settings"]);
  });
});
