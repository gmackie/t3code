import { describe, expect, it } from "vite-plus/test";

import { applyLockdownBuildConfig } from "./lockdown-build-config.ts";

describe("T3 Code Locked packaging", () => {
  it("packages its own identity with no update feed and no web-link handler", () => {
    const config = applyLockdownBuildConfig({
      appId: "com.t3tools.t3code",
      productName: "T3 Code",
      artifactName: "T3-Code-${version}-${arch}.${ext}",
      publish: [{ provider: "github", owner: "gmackie", repo: "t3code" }],
      mac: {
        extendInfo: { CFBundleDocumentTypes: [{ CFBundleTypeName: "Web page" }], Keep: true },
        protocols: [
          { name: "T3 Code", schemes: ["t3code", "t3code-dev"] },
          { name: "Web site URL", schemes: ["http", "https"], role: "Viewer" },
        ],
      },
      dmg: { title: "T3 Code (Nightly) 1.2.3 Installer" },
      linux: { executableName: "t3code", protocols: [{ name: "T3 Code", schemes: ["t3code"] }] },
    });
    expect(config.appId).toBe("com.t3tools.t3code.locked");
    expect(config.productName).toBe("T3 Code Locked");
    expect(config.artifactName).toBe("T3-Code-Locked-${version}-${arch}.${ext}");
    expect(config.publish).toBeNull();
    expect(config.mac).toEqual({
      extendInfo: { Keep: true },
      protocols: [{ name: "T3 Code Locked", schemes: ["t3code-locked", "t3code-locked-dev"] }],
    });
    expect(config.dmg).toEqual({ title: "T3 Code Locked 1.2.3 Installer" });
    expect(config.linux).toEqual({
      executableName: "t3code",
      protocols: [{ name: "T3 Code Locked", schemes: ["t3code-locked", "t3code-locked-dev"] }],
    });
  });
});
