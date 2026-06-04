import { describe, expect, it } from "vitest";

import { createDesktopElectronBuilderConfig } from "./lib/desktopElectronBuilderConfig.ts";

describe("createDesktopElectronBuilderConfig", () => {
  it("disables asar packaging so the desktop backend can run from the filesystem", () => {
    expect(
      createDesktopElectronBuilderConfig({
        platform: "mac",
        target: "dmg",
        productName: "T3 Code (gmacko)",
      }),
    ).toMatchObject({
      appId: "com.t3tools.t3code.gmacko",
      productName: "T3 Code (gmacko)",
      artifactName: "T3-Code-${version}-${arch}.${ext}",
      asar: false,
      directories: {
        buildResources: "apps/desktop/resources",
      },
      mac: {
        target: ["dmg", "zip"],
        icon: "icon.icns",
        category: "public.app-category.developer-tools",
      },
    });
  });

  it("writes a distinct updater cache name for the gmacko feed", () => {
    expect(
      createDesktopElectronBuilderConfig({
        platform: "mac",
        target: "dmg",
        productName: "T3 Code (gmacko)",
        publishConfig: {
          provider: "github",
          owner: "gmackie",
          repo: "t3code",
          releaseType: "release",
        },
      }),
    ).toMatchObject({
      publish: [
        {
          provider: "github",
          owner: "gmackie",
          repo: "t3code",
          releaseType: "release",
          updaterCacheDirName: "t3code-gmacko-updater",
        },
      ],
    });
  });
});
