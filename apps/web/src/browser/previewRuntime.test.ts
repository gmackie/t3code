import { describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import { rendersServerTabNatively } from "./previewRuntime.ts";

vi.mock("~/env", () => ({ isElectron: true }));
vi.mock("~/state/entities", () => ({
  readEnvironmentSupportsServerBrowser: () => true,
  useEnvironmentSupportsServerBrowser: () => true,
}));
vi.mock("~/state/primaryEnvironment", () => ({ primaryEnvironmentIdAtom: {} }));
const local = EnvironmentId.make("local");
const remote = EnvironmentId.make("remote");
describe("desktop browser runtime selection", () => {
  it("keeps ordinary local tabs native while streaming the server-owned wallet", () => {
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
