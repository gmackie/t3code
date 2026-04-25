import { beforeEach, describe, expect, it, vi } from "vitest";

const { execFileSyncMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFileSync: execFileSyncMock,
}));

import { resolveTailnetAdvertisedHost } from "./tailscale.ts";

describe("resolveTailnetAdvertisedHost", () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
  });

  it("prefers an explicit tailnet host when configured", () => {
    expect(
      resolveTailnetAdvertisedHost({
        tailnetHost: "desktop.tailnet.ts.net",
        tsCertDomain: "mackbook.tailnet.ts.net",
      }),
    ).toBe("desktop.tailnet.ts.net");
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  it("prefers TS_CERT_DOMAIN when available", () => {
    expect(
      resolveTailnetAdvertisedHost({
        tsCertDomain: "mackbook.tailnet.ts.net",
      }),
    ).toBe("mackbook.tailnet.ts.net");
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  it("falls back to tailscale ip -4 when no explicit tailnet host is configured", () => {
    execFileSyncMock.mockReturnValue("100.88.12.4\n100.64.0.1");

    expect(resolveTailnetAdvertisedHost()).toBe("100.88.12.4");
    expect(execFileSyncMock).toHaveBeenCalledWith("tailscale", ["ip", "-4"], {
      encoding: "utf8",
    });
  });

  it("falls back to a Tailnet interface address when the tailscale CLI is unavailable", () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error("tailscale not installed");
    });

    expect(
      resolveTailnetAdvertisedHost({
        networkInterfaces: {
          en0: [
            {
              address: "192.168.1.44",
              family: "IPv4",
              internal: false,
              netmask: "255.255.255.0",
              cidr: "192.168.1.44/24",
              mac: "00:00:00:00:00:00",
            },
          ],
          utun5: [
            {
              address: "100.76.132.28",
              family: "IPv4",
              internal: false,
              netmask: "255.255.255.255",
              cidr: "100.76.132.28/32",
              mac: "00:00:00:00:00:00",
            },
          ],
        },
      }),
    ).toBe("100.76.132.28");
  });

  it("returns null when tailscale host detection fails", () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error("tailscale not installed");
    });

    expect(resolveTailnetAdvertisedHost()).toBeNull();
  });
});
