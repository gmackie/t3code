import type { DesktopEnvironmentBootstrap } from "@t3tools/contracts";
import type { KnownEnvironment } from "@t3tools/client-runtime";

export interface PrimaryEnvironmentTarget {
  readonly source: KnownEnvironment["source"];
  readonly target: KnownEnvironment["target"];
}

function getDesktopLocalEnvironmentBootstrap(): DesktopEnvironmentBootstrap | null {
  return window.desktopBridge?.getLocalEnvironmentBootstrap() ?? null;
}

function deriveHttpBaseUrlFromWsBaseUrl(wsBaseUrl: string): string {
  const url = new URL(wsBaseUrl, window.location.origin);
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

function normalizeBaseUrl(rawValue: string): string {
  return new URL(rawValue, window.location.origin).toString();
}

function resolveConfiguredPrimaryTarget(): PrimaryEnvironmentTarget | null {
  const configuredHttpBaseUrl = import.meta.env.VITE_HTTP_URL?.trim();
  const configuredWsBaseUrl = import.meta.env.VITE_WS_URL?.trim();

  if (!configuredHttpBaseUrl && !configuredWsBaseUrl) {
    return null;
  }

  if (!configuredHttpBaseUrl || !configuredWsBaseUrl) {
    throw new Error("Configured primary environments require both VITE_HTTP_URL and VITE_WS_URL.");
  }

  return {
    source: "configured",
    target: {
      httpBaseUrl: normalizeBaseUrl(configuredHttpBaseUrl),
      wsBaseUrl: normalizeBaseUrl(configuredWsBaseUrl),
    },
  };
}

function resolveWindowOriginPrimaryTarget(): PrimaryEnvironmentTarget {
  const httpBaseUrl = normalizeBaseUrl(window.location.origin);
  const url = new URL(httpBaseUrl);
  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else {
    throw new Error(`Unsupported HTTP base URL protocol: ${url.protocol}`);
  }
  return {
    source: "window-origin",
    target: {
      httpBaseUrl,
      wsBaseUrl: url.toString(),
    },
  };
}

function resolveDesktopPrimaryTarget(): PrimaryEnvironmentTarget | null {
  const desktopBootstrap = getDesktopLocalEnvironmentBootstrap();
  if (!desktopBootstrap) {
    return null;
  }
  const wsBaseUrl = desktopBootstrap.wsBaseUrl?.trim() || desktopBootstrap.wsUrl?.trim() || null;
  const httpBaseUrl =
    desktopBootstrap.httpBaseUrl?.trim() ||
    (wsBaseUrl ? deriveHttpBaseUrlFromWsBaseUrl(wsBaseUrl) : null);

  if (!httpBaseUrl && !wsBaseUrl) {
    return null;
  }
  if (!httpBaseUrl || !wsBaseUrl) {
    throw new Error(
      "Desktop bootstrap must provide both httpBaseUrl and wsBaseUrl for the local environment.",
    );
  }

  return {
    source: "desktop-managed",
    target: {
      httpBaseUrl: normalizeBaseUrl(httpBaseUrl),
      wsBaseUrl: normalizeBaseUrl(wsBaseUrl),
    },
  };
}

export function resolvePrimaryEnvironmentHttpUrl(
  pathname: string,
  searchParams?: Record<string, string>,
): string {
  const primaryTarget = readPrimaryEnvironmentTarget();
  if (!primaryTarget) {
    throw new Error("Unable to resolve the primary environment HTTP base URL.");
  }

  const url = new URL(primaryTarget.target.httpBaseUrl);
  url.pathname = pathname;
  if (searchParams) {
    url.search = new URLSearchParams(searchParams).toString();
  }
  return url.toString();
}

export function readPrimaryEnvironmentTarget(): PrimaryEnvironmentTarget | null {
  return (
    resolveDesktopPrimaryTarget() ??
    resolveConfiguredPrimaryTarget() ??
    resolveWindowOriginPrimaryTarget()
  );
}
