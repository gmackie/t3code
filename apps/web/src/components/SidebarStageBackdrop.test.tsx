import { describe, expect, it } from "vite-plus/test";

import { resolveEnvironmentIdentificationPillLabel } from "./SidebarStageBackdrop";

describe("SidebarStageBackdrop", () => {
  it("labels the GMACKO lane unless identification is turned off", () => {
    expect(resolveEnvironmentIdentificationPillLabel("Gmacko")).toBe("GMACKO");
    expect(resolveEnvironmentIdentificationPillLabel("Gmacko", "artwork")).toBe("GMACKO");
    expect(resolveEnvironmentIdentificationPillLabel("Nightly", "artwork")).toBeNull();
    expect(resolveEnvironmentIdentificationPillLabel("Gmacko", "none")).toBeNull();
  });
});
