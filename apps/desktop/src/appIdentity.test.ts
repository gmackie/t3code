import { describe, expect, it } from "vite-plus/test";
import { getDesktopRuntimeIdentity } from "./appIdentity.js";
describe("locked fork identity", () => {
  it("uses its own profile even when given the upstream product name", () => {
    const identity = getDesktopRuntimeIdentity({
      isDevelopment: false,
      appDisplayName: "T3 Code (Alpha)",
    });
    expect(identity.appId).toBe("com.t3tools.t3code.locked");
    expect(identity.baseDirName).toBe(".t3-locked");
    expect(identity.userDataDirName).toBe("t3code-locked");
  });
  it("isolates development from installed fork data", () => {
    const installed = getDesktopRuntimeIdentity({ isDevelopment: false, appDisplayName: null });
    const development = getDesktopRuntimeIdentity({ isDevelopment: true, appDisplayName: null });
    expect(development.userDataDirName).not.toBe(installed.userDataDirName);
    expect(development.stateDirName).not.toBe(installed.stateDirName);
  });
});
