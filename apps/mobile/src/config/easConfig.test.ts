import { describe, expect, it } from "vitest";

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
});
