export interface SessionTarget {
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
}

const EXPLICIT_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//;

function toNormalizedUrl(rawValue: string, options?: { readonly baseUrl?: string }): URL {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    throw new Error("Enter a backend URL.");
  }

  const normalizedInput =
    EXPLICIT_SCHEME_PATTERN.test(trimmed) || trimmed.startsWith("//")
      ? trimmed
      : `https://${trimmed}`;
  const url = new URL(normalizedInput, options?.baseUrl);
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}

export function wsToHttpBaseUrl(
  wsBaseUrl: string,
  options?: { readonly baseUrl?: string },
): string {
  const url = toNormalizedUrl(wsBaseUrl, options);
  if (url.protocol === "ws:") {
    url.protocol = "http:";
  } else if (url.protocol === "wss:") {
    url.protocol = "https:";
  }
  return url.toString();
}

export function httpToWsBaseUrl(
  httpBaseUrl: string,
  options?: { readonly baseUrl?: string },
): string {
  const url = toNormalizedUrl(httpBaseUrl, options);
  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  }
  return url.toString();
}

export function resolveSessionTarget(
  rawValue: string,
  options?: { readonly baseUrl?: string },
): SessionTarget {
  const httpBaseUrl = wsToHttpBaseUrl(rawValue, options);
  return {
    httpBaseUrl,
    wsBaseUrl: httpToWsBaseUrl(httpBaseUrl),
  };
}
