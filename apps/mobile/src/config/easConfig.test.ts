import { describe, expect, it } from "vitest";

import npmrc from "../../../../.npmrc?raw";
import rootEasIgnore from "../../../../.easignore?raw";
import easIgnore from "../../.easignore?raw";
import appConfig from "../../app.json";
import easConfig from "../../eas.json";
import packageJson from "../../package.json";

const easBuildConfig = easConfig.build as Record<string, any>;
const easSubmitConfig = easConfig.submit as Record<string, any>;

describe("mobile EAS configuration", () => {
  it("uses the gmacko development bundle identifier for iOS builds", () => {
    expect(appConfig.expo?.owner).toBe("gmacko");
    expect(appConfig.expo?.ios?.bundleIdentifier).toBe("com.gmacko.t3code.dev");
    expect(appConfig.expo?.ios?.infoPlist?.ITSAppUsesNonExemptEncryption).toBe(false);
  });

  it("allows the dev client to pair with local Tailnet HTTP backends", () => {
    expect(appConfig.expo?.plugins).toContainEqual([
      "expo-build-properties",
      {
        android: { networkInspector: false },
        ios: { networkInspector: false },
      },
    ]);
    expect(appConfig.expo?.ios?.infoPlist?.NSLocalNetworkUsageDescription).toBe(
      "Allow T3 Code to connect to your Mac on your local network or Tailnet.",
    );
    expect(appConfig.expo?.ios?.infoPlist?.NSAppTransportSecurity?.NSAllowsArbitraryLoads).toBe(
      true,
    );
    expect(appConfig.expo?.ios?.infoPlist?.NSAppTransportSecurity?.NSAllowsLocalNetworking).toBe(
      true,
    );
  });

  it("defines EAS build and submit profiles for iOS", () => {
    expect(easBuildConfig.development?.developmentClient).toBe(true);
    expect(easBuildConfig.development?.distribution).toBe("internal");
    expect(Object.hasOwn(easBuildConfig.development?.ios ?? {}, "simulator")).toBe(false);
    expect(packageJson.dependencies?.["expo-build-properties"]).toBeDefined();
    expect(packageJson.dependencies?.["expo-dev-client"]).toBeDefined();
    expect(easBuildConfig.simulator?.developmentClient).toBe(true);
    expect(easBuildConfig.simulator?.ios?.simulator).toBe(true);
    expect(easBuildConfig.preview?.ios).toBeDefined();
    expect(easBuildConfig.production?.ios).toBeDefined();
    expect(easSubmitConfig.production?.ios).toBeDefined();
  });

  it("disables Bun lifecycle scripts during EAS dependency installs", () => {
    expect(npmrc).toMatch(/^ignore-scripts=true$/m);
  });

  it("excludes local native build artifacts from EAS archives", () => {
    expect(rootEasIgnore).toMatch(/^apps\/mobile\/ios\/$/m);
    expect(rootEasIgnore).toMatch(/^\.tmp-build\/$/m);
    expect(rootEasIgnore).toMatch(/^release-gmacko-\*\/$/m);
    expect(easIgnore).toMatch(/^ios\/$/m);
    expect(easIgnore).toMatch(/^\.expo\/$/m);
    expect(easIgnore).toMatch(/^node_modules\/$/m);
  });
});
