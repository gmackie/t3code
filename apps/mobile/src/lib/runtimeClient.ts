import type {
  AuthWebSocketTokenResult,
  OrchestrationReadModel,
  PersistedSavedEnvironmentRecord,
} from "@t3tools/contracts";

import { createBearerHeaders } from "@t3tools/client-runtime";

function buildUrl(httpBaseUrl: string, pathname: string): string {
  const url = new URL(httpBaseUrl);
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function readError(response: Response, fallback: string): Promise<string> {
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
    // Fall back to text.
  }

  return text;
}

export async function issueWsToken(input: {
  readonly httpBaseUrl: string;
  readonly sessionToken: string;
  readonly fetch?: typeof globalThis.fetch;
}): Promise<AuthWebSocketTokenResult> {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const response = await fetchImpl(buildUrl(input.httpBaseUrl, "/api/auth/ws-token"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...createBearerHeaders(input.sessionToken),
    },
  });

  if (!response.ok) {
    throw new Error(await readError(response, "Unable to issue WebSocket token."));
  }

  return (await response.json()) as AuthWebSocketTokenResult;
}

export async function fetchRuntimeSnapshot(input: {
  readonly httpBaseUrl: string;
  readonly sessionToken: string;
  readonly fetch?: typeof globalThis.fetch;
}): Promise<OrchestrationReadModel> {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const response = await fetchImpl(buildUrl(input.httpBaseUrl, "/api/orchestration/snapshot"), {
    headers: createBearerHeaders(input.sessionToken),
  });

  if (!response.ok) {
    throw new Error(await readError(response, "Unable to load orchestration snapshot."));
  }

  return (await response.json()) as OrchestrationReadModel;
}

export async function loadSavedEnvironmentSnapshot(input: {
  readonly record: PersistedSavedEnvironmentRecord;
  readonly sessionToken: string;
  readonly fetch?: typeof globalThis.fetch;
}): Promise<{
  readonly environmentId: PersistedSavedEnvironmentRecord["environmentId"];
  readonly snapshot: OrchestrationReadModel;
}> {
  return {
    environmentId: input.record.environmentId,
    snapshot: await fetchRuntimeSnapshot({
      httpBaseUrl: input.record.httpBaseUrl,
      sessionToken: input.sessionToken,
      ...(input.fetch ? { fetch: input.fetch } : {}),
    }),
  };
}
