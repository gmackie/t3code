import { networkInterfaces } from "node:os";

import { resolveTailnetAdvertisedHost } from "@t3tools/shared/tailscale";
import { QrCode } from "@t3tools/shared/qrCode";
import { Effect } from "effect";
import { HttpServer } from "effect/unstable/http";

import { ServerConfig } from "./config.ts";
import { ServerAuth } from "./auth/Services/ServerAuth.ts";

export interface HeadlessServeAccessInfo {
  readonly connectionString: string;
  readonly token: string;
  readonly pairingUrl: string;
}

type NetworkInterfacesMap = ReturnType<typeof networkInterfaces>;

interface HeadlessConnectionResolutionOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly resolveTailnetHost?: typeof resolveTailnetAdvertisedHost;
}

export const isLoopbackHost = (host: string | undefined): boolean => {
  if (!host || host.length === 0) {
    return true;
  }

  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]" ||
    host.startsWith("127.")
  );
};

export const isWildcardHost = (host: string | undefined): boolean =>
  host === "0.0.0.0" || host === "::" || host === "[::]";

export const formatHostForUrl = (host: string): string =>
  host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;

const normalizeHost = (host: string): string =>
  host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;

const normalizeConfiguredHostValue = (value: string | undefined): string | undefined => {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
};

const isIpv4Family = (family: string | number): boolean => family === "IPv4" || family === 4;

const isIpv6Family = (family: string | number): boolean => family === "IPv6" || family === 6;

export const resolveHeadlessConnectionHost = (
  host: string | undefined,
  interfaces: NetworkInterfacesMap = networkInterfaces(),
  options?: HeadlessConnectionResolutionOptions,
): string => {
  const resolvePreferredTailnetHost = (): string | null => {
    const env = options?.env ?? process.env;
    const resolveHost = options?.resolveTailnetHost ?? resolveTailnetAdvertisedHost;
    const configuredTailnetHost = normalizeConfiguredHostValue(env.T3CODE_TAILNET_HOST);
    const configuredTsCertDomain = normalizeConfiguredHostValue(env.TS_CERT_DOMAIN);
    return resolveHost({
      ...(configuredTailnetHost ? { tailnetHost: configuredTailnetHost } : {}),
      ...(configuredTsCertDomain ? { tsCertDomain: configuredTsCertDomain } : {}),
    });
  };

  if (!host) {
    return resolvePreferredTailnetHost() ?? "localhost";
  }

  if (!isWildcardHost(host)) {
    return normalizeHost(host);
  }

  const preferredTailnetHost = resolvePreferredTailnetHost();
  if (preferredTailnetHost) {
    return preferredTailnetHost;
  }

  const interfaceEntries = Object.values(interfaces).flatMap((entries) => entries ?? []);
  const externalIpv4 = interfaceEntries.find(
    (entry) => !entry.internal && isIpv4Family(entry.family),
  );
  if (externalIpv4) {
    return externalIpv4.address;
  }

  const externalIpv6 = interfaceEntries.find(
    (entry) => !entry.internal && isIpv6Family(entry.family),
  );
  return externalIpv6 ? normalizeHost(externalIpv6.address) : "localhost";
};

export const resolveHeadlessConnectionString = (
  host: string | undefined,
  port: number,
  interfaces: NetworkInterfacesMap = networkInterfaces(),
  options?: HeadlessConnectionResolutionOptions,
): string => {
  const connectionHost = resolveHeadlessConnectionHost(host, interfaces, options);
  return `http://${formatHostForUrl(connectionHost)}:${port}`;
};

export const resolveListeningPort = (address: unknown, fallbackPort: number): number => {
  if (
    typeof address === "object" &&
    address !== null &&
    "port" in address &&
    typeof address.port === "number"
  ) {
    return address.port;
  }
  return fallbackPort;
};

const PAIRING_PATHNAME = "/pair";

const setPairingUrlToken = (url: URL, token: string): URL => {
  url.pathname = PAIRING_PATHNAME;
  url.searchParams.delete("token");
  url.hash = new URLSearchParams([["token", token]]).toString();
  return url;
};

export const buildPairingUrl = (connectionString: string, token: string): string => {
  return setPairingUrlToken(new URL(connectionString), token).toString();
};

export const renderTerminalQrCode = (value: string, margin = 2): string => {
  const qrCode = QrCode.encodeText(value, QrCode.Ecc.MEDIUM);
  const rows: Array<string> = [];
  const isDark = (x: number, y: number): boolean =>
    x >= 0 && x < qrCode.size && y >= 0 && y < qrCode.size && qrCode.getModule(x, y);

  for (let y = -margin; y < qrCode.size + margin; y += 2) {
    let row = "";

    for (let x = -margin; x < qrCode.size + margin; x += 1) {
      const topDark = isDark(x, y);
      const bottomDark = isDark(x, y + 1);

      row += topDark ? (bottomDark ? "█" : "▀") : bottomDark ? "▄" : " ";
    }

    rows.push(row);
  }

  return rows.join("\n");
};

export const formatHeadlessServeOutput = (accessInfo: HeadlessServeAccessInfo): string =>
  [
    "T3 Code server is ready.",
    `Connection string: ${accessInfo.connectionString}`,
    `Token: ${accessInfo.token}`,
    `Pairing URL: ${accessInfo.pairingUrl}`,
    "",
    renderTerminalQrCode(accessInfo.pairingUrl),
    "",
  ].join("\n");

export const issueHeadlessServeAccessInfo = Effect.fn("issueHeadlessServeAccessInfo")(function* () {
  const serverConfig = yield* ServerConfig;
  const httpServer = yield* HttpServer.HttpServer;
  const serverAuth = yield* ServerAuth;
  const connectionString = resolveHeadlessConnectionString(
    serverConfig.host,
    resolveListeningPort(httpServer.address, serverConfig.port),
  );
  const issued = yield* serverAuth.issuePairingCredential({ role: "owner" });

  return {
    connectionString,
    token: issued.credential,
    pairingUrl: buildPairingUrl(connectionString, issued.credential),
  } satisfies HeadlessServeAccessInfo;
});
