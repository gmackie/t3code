import type { AuthBearerBootstrapResult, ExecutionEnvironmentDescriptor } from "@t3tools/contracts";

import { createBearerHeaders } from "@t3tools/client-runtime";

function buildEndpointUrl(httpBaseUrl: string, pathname: string): string {
  const url = new URL(httpBaseUrl);
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString();
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
    throw new Error(`Could not reach ${endpointUrl}. Native error: ${message}`, { cause: error });
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
