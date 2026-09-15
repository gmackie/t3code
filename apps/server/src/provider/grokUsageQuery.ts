import * as NodeOS from "node:os";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

import { normalizeGrokBillingRateLimits, type ProviderRateLimitWindow } from "./providerUsage.ts";

const GROK_BILLING_ENDPOINT = "https://cli-chat-proxy.grok.com/v1/billing?format=credits";
const USAGE_QUERY_TIMEOUT_MS = 15_000;

export function grokAuthFilePath(path: Path.Path, homeDir = NodeOS.homedir()): string {
  return path.join(homeDir, ".grok", "auth.json");
}

export function extractGrokAccessToken(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const credentials = Object.values(value as Record<string, unknown>).flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const key = typeof record.key === "string" ? record.key.trim() : "";
    if (key.length === 0) return [];
    return [{ key, refreshable: typeof record.refresh_token === "string" }];
  });
  return credentials.find(({ refreshable }) => refreshable)?.key ?? credentials[0]?.key;
}

const decodeUnknownJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));

export const queryGrokUsageRateLimits: Effect.Effect<
  ReadonlyArray<ProviderRateLimitWindow>,
  never,
  FileSystem.FileSystem | HttpClient.HttpClient | Path.Path
> = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const contents = yield* fileSystem.readFileString(grokAuthFilePath(path));
  const token = extractGrokAccessToken(yield* decodeUnknownJson(contents));
  if (token === undefined) return [];

  const client = yield* HttpClient.HttpClient;
  const response = yield* client.execute(
    HttpClientRequest.get(GROK_BILLING_ENDPOINT).pipe(
      HttpClientRequest.bearerToken(token),
      HttpClientRequest.setHeader("accept", "application/json"),
      HttpClientRequest.setHeader("x-grok-client-mode", "build"),
    ),
  );
  if (response.status < 200 || response.status >= 300) return [];
  return normalizeGrokBillingRateLimits(yield* response.json);
}).pipe(
  Effect.timeoutOption(USAGE_QUERY_TIMEOUT_MS),
  Effect.map(Option.getOrElse(() => [] as ReadonlyArray<ProviderRateLimitWindow>)),
  Effect.orElseSucceed(() => []),
);
