import type { DesktopEnvironmentBootstrap } from "@t3tools/contracts";

function deriveHttpBaseUrl(wsBaseUrl: string | null): string | null {
  if (!wsBaseUrl) {
    return null;
  }
  const url = new URL(wsBaseUrl);
  if (url.protocol === "ws:") {
    url.protocol = "http:";
    return url.toString();
  }
  if (url.protocol === "wss:") {
    url.protocol = "https:";
    return url.toString();
  }
  throw new Error(`Unsupported websocket base URL protocol: ${url.protocol}`);
}

export function createLocalEnvironmentBootstrap(input: {
  readonly label: string;
  readonly wsBaseUrl: string | null;
  readonly bootstrapToken?: string;
}): DesktopEnvironmentBootstrap {
  const wsBaseUrl = input.wsBaseUrl?.trim() || null;
  const bootstrapToken = input.bootstrapToken?.trim();
  return {
    label: input.label,
    httpBaseUrl: deriveHttpBaseUrl(wsBaseUrl),
    wsBaseUrl,
    ...(bootstrapToken ? { bootstrapToken } : {}),
  };
}
