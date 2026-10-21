import type { EnvironmentId } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({ desktop: false }));

vi.mock("~/env", () => ({
  get isElectron() {
    return state.desktop;
  },
}));
vi.mock("~/previewStateStore", () => ({ isPreviewSupportedInRuntime: () => state.desktop }));
vi.mock("~/rpc/atomRegistry", () => ({ appAtomRegistry: { get: () => null } }));
vi.mock("~/state/primaryEnvironment", () => ({ primaryEnvironmentIdAtom: {} }));
vi.mock("~/state/entities", () => ({
  readEnvironmentSupportsServerBrowser: () => false,
  useEnvironmentSupportsServerBrowser: () => false,
}));

import { rendersServerTabNatively } from "./previewRuntime";

const local = "local" as EnvironmentId;
const remote = "remote" as EnvironmentId;

afterEach(() => {
  state.desktop = false;
});

describe("rendersServerTabNatively", () => {
  it("keeps ordinary local tabs native while streaming the server-owned wallet", () => {
    state.desktop = true;

    expect(
      rendersServerTabNatively(local, local, { runtime: "server", profileId: "default" }),
    ).toBe(true);
    expect(
      rendersServerTabNatively(local, local, { runtime: "server", profileId: "metamask" }),
    ).toBe(false);
    expect(
      rendersServerTabNatively(remote, local, { runtime: "server", profileId: "default" }),
    ).toBe(false);
  });
});
