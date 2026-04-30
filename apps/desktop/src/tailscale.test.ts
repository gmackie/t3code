import { beforeEach, describe, expect, it, vi } from "vitest";

const { execFileSyncMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFileSync: execFileSyncMock,
}));

import { ensureTailnetServeProxy, resolveTailnetAdvertisedHost } from "./tailscale.ts";

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

  it("prefers the Tailscale HTTPS cert domain before falling back to a raw Tailnet IP", () => {
    execFileSyncMock.mockImplementation((command: string, args: string[]) => {
      if (command === "tailscale" && args.join(" ") === "status --json") {
        return JSON.stringify({
          CertDomains: ["mackbook.tail1e1a32.ts.net"],
        });
      }

      if (command === "tailscale" && args.join(" ") === "ip -4") {
        return "100.88.12.4\n";
      }

      throw new Error(`unexpected command ${command} ${args.join(" ")}`);
    });

    expect(resolveTailnetAdvertisedHost()).toBe("mackbook.tail1e1a32.ts.net");
  });

  it("uses the Tailscale MagicDNS self name before falling back to a raw Tailnet IP", () => {
    execFileSyncMock.mockImplementation((command: string, args: string[]) => {
      if (command === "tailscale" && args.join(" ") === "status --json") {
        return JSON.stringify({
          Self: {
            DNSName: "mackbook.tail1e1a32.ts.net.",
          },
        });
      }

      if (command === "tailscale" && args.join(" ") === "ip -4") {
        return "100.88.12.4\n";
      }

      throw new Error(`unexpected command ${command} ${args.join(" ")}`);
    });

    expect(resolveTailnetAdvertisedHost()).toBe("mackbook.tail1e1a32.ts.net");
  });

  it("prefers the configured Tailscale Serve HTTPS host before falling back to status or raw IP", () => {
    execFileSyncMock.mockImplementation((command: string, args: string[]) => {
      if (command === "tailscale" && args.join(" ") === "serve status --json") {
        return JSON.stringify({
          TCP: {
            "443": {
              HTTPS: true,
            },
          },
          Web: {
            "mackbook.tail1e1a32.ts.net:443": {
              Handlers: {
                "/": {
                  Proxy: "http://127.0.0.1:3773",
                },
              },
            },
          },
        });
      }

      if (command === "tailscale" && args.join(" ") === "status --json") {
        return JSON.stringify({
          CertDomains: ["fallback.tail1e1a32.ts.net"],
        });
      }

      if (command === "tailscale" && args.join(" ") === "ip -4") {
        return "100.88.12.4\n";
      }

      throw new Error(`unexpected command ${command} ${args.join(" ")}`);
    });

    expect(resolveTailnetAdvertisedHost()).toBe("mackbook.tail1e1a32.ts.net");
  });

  it("prefers the configured Tailscale Serve HTTPS host over a raw Tailnet host override", () => {
    execFileSyncMock.mockImplementation((command: string, args: string[]) => {
      if (command === "tailscale" && args.join(" ") === "serve status --json") {
        return JSON.stringify({
          Web: {
            "mackbook.tail1e1a32.ts.net:443": {
              Handlers: {
                "/": {
                  Proxy: "http://127.0.0.1:3773",
                },
              },
            },
          },
        });
      }

      throw new Error(`unexpected command ${command} ${args.join(" ")}`);
    });

    expect(
      resolveTailnetAdvertisedHost({
        tailnetHost: "100.76.132.28",
        serveProxyPort: 3773,
      }),
    ).toBe("mackbook.tail1e1a32.ts.net");
  });

  it("does not return a raw Tailnet IP when a Serve proxy is required but unavailable", () => {
    execFileSyncMock.mockImplementation((command: string, args: string[]) => {
      if (args.join(" ") === "serve status --json") {
        return JSON.stringify({ Web: {} });
      }

      if (args.join(" ") === "status --json") {
        return JSON.stringify({});
      }

      if (args.join(" ") === "ip -4") {
        return "100.88.12.4\n";
      }

      throw new Error(`unexpected command ${command} ${args.join(" ")}`);
    });

    expect(
      resolveTailnetAdvertisedHost({
        tailnetHost: "100.76.132.28",
        serveProxyPort: 3773,
      }),
    ).toBeNull();
  });

  it("uses the macOS Tailscale app binary when the shell CLI is not installed", () => {
    execFileSyncMock.mockImplementation((command: string, args: string[]) => {
      if (command === "tailscale") {
        throw new Error("tailscale not installed");
      }

      if (
        command === "/Applications/Tailscale.app/Contents/MacOS/Tailscale" &&
        args.join(" ") === "status --json"
      ) {
        return JSON.stringify({
          CertDomains: ["mackbook.tail1e1a32.ts.net."],
        });
      }

      throw new Error(`unexpected command ${command} ${args.join(" ")}`);
    });

    expect(resolveTailnetAdvertisedHost()).toBe("mackbook.tail1e1a32.ts.net");
  });

  it("falls back to tailscale ip -4 when no explicit tailnet host is configured", () => {
    execFileSyncMock.mockReturnValue("100.88.12.4\n100.64.0.1");

    expect(resolveTailnetAdvertisedHost()).toBe("100.88.12.4");
    expect(execFileSyncMock).toHaveBeenCalledWith("tailscale", ["ip", "-4"], {
      encoding: "utf8",
    });
  });

  it("ignores invalid CLI output instead of treating the first word as a host", () => {
    execFileSyncMock.mockImplementation((command: string, args: string[]) => {
      if (args.join(" ") === "status --json") {
        throw new Error(`no status from ${command}`);
      }

      if (args.join(" ") === "ip -4") {
        return "The easiest, most secure way to use WireGuard.\n\nUSAGE\n";
      }

      throw new Error(`unexpected command ${command} ${args.join(" ")}`);
    });

    expect(resolveTailnetAdvertisedHost()).toBeNull();
  });

  it("ignores an invalid TS_CERT_DOMAIN value and uses the detected cert domain", () => {
    execFileSyncMock.mockImplementation((command: string, args: string[]) => {
      if (
        command === "/Applications/Tailscale.app/Contents/MacOS/Tailscale" &&
        args.join(" ") === "status --json"
      ) {
        return JSON.stringify({
          CertDomains: ["mackbook.tail1e1a32.ts.net"],
        });
      }

      throw new Error(`unexpected command ${command} ${args.join(" ")}`);
    });

    expect(
      resolveTailnetAdvertisedHost({
        tsCertDomain: "The easiest, most secure way to use WireGuard.",
      }),
    ).toBe("mackbook.tail1e1a32.ts.net");
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

  it("configures a Tailscale Serve HTTPS proxy when no matching service exists", () => {
    let serveConfigured = false;
    execFileSyncMock.mockImplementation((command: string, args: string[]) => {
      if (command !== "tailscale") {
        throw new Error(`unexpected command ${command} ${args.join(" ")}`);
      }

      if (args.join(" ") === "serve status --json") {
        return JSON.stringify({
          Web: serveConfigured
            ? {
                "mackbook.tail1e1a32.ts.net:443": {
                  Handlers: {
                    "/": {
                      Proxy: "http://127.0.0.1:3773",
                    },
                  },
                },
              }
            : {},
        });
      }

      if (args.join(" ") === "serve --bg --yes http://127.0.0.1:3773") {
        serveConfigured = true;
        return "";
      }

      throw new Error(`unexpected command ${command} ${args.join(" ")}`);
    });

    expect(ensureTailnetServeProxy({ port: 3773 })).toBe("mackbook.tail1e1a32.ts.net");
  });
});
