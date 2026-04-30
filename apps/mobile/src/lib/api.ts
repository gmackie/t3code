import type { AuthBearerBootstrapResult, ExecutionEnvironmentDescriptor } from "@t3tools/contracts";

import { createBearerHeaders } from "@t3tools/client-runtime";

function buildEndpointUrl(httpBaseUrl: string, pathname: string): string {
  const url = new URL(httpBaseUrl);
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function isPrivateOrTailnetHttpUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (url.protocol !== "http:") {
    return false;
  }

  const hostname = url.hostname;
  const parts = hostname.split(".").map((part) => Number.parseInt(part, 10));
  if (
    parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
  ) {
    const [first = 0, second = 0] = parts;
    return (
      first === 10 ||
      first === 127 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 100 && second >= 64 && second <= 127)
    );
  }

  return hostname.endsWith(".local") || hostname.endsWith(".ts.net");
}

function formatNetworkFailureMessage(endpointUrl: string, nativeMessage: string): string {
  const baseMessage = `Could not reach ${endpointUrl}. Native error: ${nativeMessage}`;
  if (!isPrivateOrTailnetHttpUrl(endpointUrl)) {
    return baseMessage;
  }

  return `${baseMessage}\n\nThis request failed before the pairing token was exchanged. On iOS, verify Tailscale is connected and enable Local Network access for T3 Code Mobile in Settings. Safari can still reach private addresses even when app-level local network access is blocked.`;
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  const text = await response.text();
  if (!text) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(text) as { readonly error?: string };
    if (typeof parsed.error === "string" && parsed.error.length > 0) {
      return parsed.error;
    }
  } catch {
    // Fall back to the raw payload.
  }

  return text;
}

async function fetchJson<T>(input: {
  readonly httpBaseUrl: string;
  readonly pathname: string;
  readonly fetch: typeof globalThis.fetch;
  readonly method?: "GET" | "POST";
  readonly bearerToken?: string;
  readonly body?: unknown;
}): Promise<T> {
  const endpointUrl = buildEndpointUrl(input.httpBaseUrl, input.pathname);
  let response: Response;
  try {
    response = await input.fetch(endpointUrl, {
      method: input.method ?? "GET",
      headers: {
        ...(input.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(input.bearerToken ? createBearerHeaders(input.bearerToken) : {}),
      },
      ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(formatNetworkFailureMessage(endpointUrl, message), { cause: error });
  }

  if (!response.ok) {
    throw new Error(
      await readErrorMessage(response, `Request failed for ${endpointUrl} (${response.status}).`),
    );
  }

  return (await response.json()) as T;
}

export function fetchEnvironmentDescriptor(input: {
  readonly httpBaseUrl: string;
  readonly fetch: typeof globalThis.fetch;
}): Promise<ExecutionEnvironmentDescriptor> {
  return fetchJson<ExecutionEnvironmentDescriptor>({
    httpBaseUrl: input.httpBaseUrl,
    pathname: "/.well-known/t3/environment",
    fetch: input.fetch,
  });
}

export function bootstrapBearerSession(input: {
  readonly httpBaseUrl: string;
  readonly credential: string;
  readonly fetch: typeof globalThis.fetch;
}): Promise<AuthBearerBootstrapResult> {
  return fetchJson<AuthBearerBootstrapResult>({
    httpBaseUrl: input.httpBaseUrl,
    pathname: "/api/auth/bootstrap/bearer",
    method: "POST",
    fetch: input.fetch,
    body: {
      credential: input.credential,
    },
  });
}
