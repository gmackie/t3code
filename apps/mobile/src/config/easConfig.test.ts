import { describe, expect, it } from "vitest";

import npmrc from "../../../../.npmrc?raw";
import easIgnore from "../../.easignore?raw";
import appConfig from "../../app.json";
import easConfig from "../../eas.json";
import packageJson from "../../package.json";

describe("mobile EAS configuration", () => {
  it("uses the gmacko development bundle identifier for iOS builds", () => {
    expect(appConfig.expo?.owner).toBe("gmacko");
    expect(appConfig.expo?.ios?.bundleIdentifier).toBe("com.gmacko.t3code.dev");
    expect(appConfig.expo?.ios?.infoPlist?.ITSAppUsesNonExemptEncryption).toBe(false);
  });

  it("defines EAS build and submit profiles for iOS", () => {
    expect(easConfig.build?.development?.developmentClient).toBe(true);
    expect(easConfig.build?.development?.distribution).toBe("internal");
    expect(Object.hasOwn(easConfig.build?.development?.ios ?? {}, "simulator")).toBe(false);
    expect(packageJson.dependencies?.["expo-dev-client"]).toBeDefined();
    expect(easConfig.build?.simulator?.developmentClient).toBe(true);
    expect(easConfig.build?.simulator?.ios?.simulator).toBe(true);
    expect(easConfig.build?.preview?.ios).toBeDefined();
    expect(easConfig.build?.production?.ios).toBeDefined();
    expect(easConfig.submit?.production?.ios).toBeDefined();
  });

  it("disables Bun lifecycle scripts during EAS dependency installs", () => {
    expect(npmrc).toMatch(/^ignore-scripts=true$/m);
  });

  it("excludes local native build artifacts from EAS archives", () => {
    expect(easIgnore).toMatch(/^ios\/$/m);
    expect(easIgnore).toMatch(/^\.expo\/$/m);
    expect(easIgnore).toMatch(/^node_modules\/$/m);
  });
});
