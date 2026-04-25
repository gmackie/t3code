import { describe, expect, it } from "vitest";

import appConfig from "../../app.json";
import easConfig from "../../eas.json";

describe("mobile EAS configuration", () => {
  it("uses the gmacko development bundle identifier for iOS builds", () => {
    expect(appConfig.expo?.owner).toBe("gmacko");
    expect(appConfig.expo?.ios?.bundleIdentifier).toBe("com.gmacko.t3code.dev");
  });

  it("defines EAS build and submit profiles for iOS", () => {
    expect(easConfig.build?.development?.ios).toBeDefined();
    expect(easConfig.build?.preview?.ios).toBeDefined();
    expect(easConfig.build?.production?.ios).toBeDefined();
    expect(easConfig.submit?.production?.ios).toBeDefined();
  });
});
