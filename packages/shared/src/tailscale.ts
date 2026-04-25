import { execFileSync } from "node:child_process";
import type { NetworkInterfaceInfo } from "node:os";

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

export function resolveTailnetAdvertisedHost(input?: {
  readonly tailnetHost?: string;
  readonly tsCertDomain?: string;
  readonly networkInterfaces?: NodeJS.Dict<NetworkInterfaceInfo[]>;
}): string | null {
  const directHost = firstNonEmpty([input?.tailnetHost, input?.tsCertDomain]);
  if (directHost) {
    return directHost;
  }

  try {
    const output = execFileSync("tailscale", ["ip", "-4"], { encoding: "utf8" });
    return firstNonEmpty(output.split(/\s+/)) ?? null;
  } catch {
    return resolveTailnetIpv4FromNetworkInterfaces(input?.networkInterfaces);
  }
}
