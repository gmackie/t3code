import { execFileSync } from "node:child_process";
import type { NetworkInterfaceInfo } from "node:os";

const TAILSCALE_CLI_CANDIDATES = [
  "tailscale",
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
] as const;

const TAILSCALE_STATUS_MAX_BUFFER_BYTES = 8 * 1024 * 1024;

function tailscaleCliEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    TERM: process.env.TERM?.trim() || "xterm-256color",
  };
}

function firstNonEmpty(values: ReadonlyArray<string | undefined>): string | undefined {
  return values.map((value) => value?.trim()).find((value) => value && value.length > 0);
}

function isTailnetIpv4Address(address: string): boolean {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return false;
  }

  const octets = parts.map((part) => Number.parseInt(part, 10));
  if (octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)) {
    return false;
  }

  const [first = 0, second = 0] = octets;
  return first === 100 && second >= 64 && second <= 127;
}

function isTailnetDnsName(host: string): boolean {
  return host.toLowerCase().endsWith(".ts.net");
}

function resolveTailnetIpv4FromNetworkInterfaces(
  networkInterfaces: NodeJS.Dict<NetworkInterfaceInfo[]> | undefined,
): string | null {
  if (!networkInterfaces) {
    return null;
  }

  for (const interfaceAddresses of Object.values(networkInterfaces)) {
    if (!interfaceAddresses) continue;

    for (const address of interfaceAddresses) {
      if (address.internal) continue;
      if (address.family !== "IPv4") continue;
      if (!isTailnetIpv4Address(address.address)) continue;
      return address.address;
    }
  }

  return null;
}

function normalizeTailnetDnsName(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\.$/, "");
  return normalized && isTailnetDnsName(normalized) ? normalized : undefined;
}

function normalizeTailnetIpv4Address(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && isTailnetIpv4Address(normalized) ? normalized : undefined;
}

function resolveTailnetServeHostFromStatus(serveProxyPort: number | undefined): string | null {
  for (const binary of TAILSCALE_CLI_CANDIDATES) {
    try {
      const output = execFileSync(binary, ["serve", "status", "--json"], {
        encoding: "utf8",
        env: tailscaleCliEnv(),
        maxBuffer: TAILSCALE_STATUS_MAX_BUFFER_BYTES,
      });
      const parsed = JSON.parse(output) as {
        readonly Web?: Record<
          string,
          {
            readonly Handlers?: Record<string, { readonly Proxy?: string }>;
          }
        >;
      };

      for (const [hostAndPort, service] of Object.entries(parsed.Web ?? {})) {
        const [host, port] = hostAndPort.split(":");
        const normalizedHost = normalizeTailnetDnsName(host);
        if (!normalizedHost || port !== "443") continue;

        if (serveProxyPort === undefined) {
          return normalizedHost;
        }

        const proxies = Object.values(service.Handlers ?? {})
          .map((handler) => handler.Proxy)
          .filter((proxy): proxy is string => Boolean(proxy));
        const matchesRequestedProxy = proxies.some((proxy) => {
          try {
            return new URL(proxy).port === String(serveProxyPort);
          } catch {
            return false;
          }
        });
        if (matchesRequestedProxy) {
          return normalizedHost;
        }
      }
    } catch {
      // Try the next known CLI location.
    }
  }

  return null;
}

export function ensureTailnetServeProxy(input: { readonly port: number }): string | null {
  const existingHost = resolveTailnetServeHostFromStatus(input.port);
  if (existingHost) {
    return existingHost;
  }

  for (const binary of TAILSCALE_CLI_CANDIDATES) {
    try {
      execFileSync(binary, ["serve", "--bg", "--yes", `http://127.0.0.1:${input.port}`], {
        encoding: "utf8",
        env: tailscaleCliEnv(),
        maxBuffer: TAILSCALE_STATUS_MAX_BUFFER_BYTES,
      });

      const configuredHost = resolveTailnetServeHostFromStatus(input.port);
      if (configuredHost) {
        return configuredHost;
      }
    } catch {
      // Try the next known CLI location.
    }
  }

  return null;
}

function resolveTailnetCertDomainFromStatus(): string | null {
  for (const binary of TAILSCALE_CLI_CANDIDATES) {
    try {
      const output = execFileSync(binary, ["status", "--json"], {
        encoding: "utf8",
        env: tailscaleCliEnv(),
        maxBuffer: TAILSCALE_STATUS_MAX_BUFFER_BYTES,
      });
      const parsed = JSON.parse(output) as {
        readonly CertDomains?: readonly string[];
        readonly Self?: { readonly DNSName?: string };
      };
      const certDomain =
        normalizeTailnetDnsName(parsed.CertDomains?.[0]) ??
        normalizeTailnetDnsName(parsed.Self?.DNSName);
      if (certDomain) {
        return certDomain;
      }
    } catch {
      // Try the next known CLI location.
    }
  }

  return null;
}

function resolveTailnetIpv4FromCli(): string | null {
  for (const binary of TAILSCALE_CLI_CANDIDATES) {
    try {
      const output = execFileSync(binary, ["ip", "-4"], {
        encoding: "utf8",
        env: tailscaleCliEnv(),
      });
      const address = firstNonEmpty(output.split(/\s+/));
      if (address && isTailnetIpv4Address(address)) {
        return address;
      }
    } catch {
      // Try the next known CLI location.
    }
  }

  return null;
}

export function resolveTailnetAdvertisedHost(input?: {
  readonly tailnetHost?: string;
  readonly tsCertDomain?: string;
  readonly serveProxyPort?: number;
  readonly networkInterfaces?: NodeJS.Dict<NetworkInterfaceInfo[]>;
}): string | null {
  if (input?.serveProxyPort !== undefined) {
    return resolveTailnetServeHostFromStatus(input.serveProxyPort);
  }

  const directDnsHost = firstNonEmpty([
    normalizeTailnetDnsName(input?.tailnetHost),
    normalizeTailnetDnsName(input?.tsCertDomain),
  ]);
  if (directDnsHost) {
    return directDnsHost;
  }

  const serveHost = resolveTailnetServeHostFromStatus(input?.serveProxyPort);
  if (serveHost) {
    return serveHost;
  }

  const certDomain = resolveTailnetCertDomainFromStatus();
  if (certDomain) {
    return certDomain;
  }

  const directTailnetIp = normalizeTailnetIpv4Address(input?.tailnetHost);
  if (directTailnetIp) {
    return directTailnetIp;
  }

  return (
    resolveTailnetIpv4FromCli() ?? resolveTailnetIpv4FromNetworkInterfaces(input?.networkInterfaces)
  );
}
