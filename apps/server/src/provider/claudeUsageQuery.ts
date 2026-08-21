import * as NodeOS from "node:os";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

import { normalizeClaudeRateLimits, type ProviderRateLimitWindow } from "./providerUsage.ts";

const CLAUDE_USAGE_ENDPOINT = "https://api.anthropic.com/api/oauth/usage";
const USAGE_QUERY_TIMEOUT_MS = 15_000;

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function extractClaudeAccessToken(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const oauth = (value as Record<string, unknown>).claudeAiOauth;
  if (!oauth || typeof oauth !== "object") return undefined;
  return nonEmptyString((oauth as Record<string, unknown>).accessToken);
}

const decodeUnknownJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));

export const queryClaudeUsageRateLimits = (
  environment?: NodeJS.ProcessEnv,
): Effect.Effect<
  ReadonlyArray<ProviderRateLimitWindow>,
  never,
  FileSystem.FileSystem | HttpClient.HttpClient | Path.Path
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const fileToken = extractClaudeAccessToken(
      yield* fileSystem
        .readFileString(path.join(NodeOS.homedir(), ".claude", ".credentials.json"))
        .pipe(
          Effect.flatMap(decodeUnknownJson),
          Effect.orElseSucceed(() => undefined),
        ),
    );
    const token = fileToken ?? nonEmptyString(environment?.CLAUDE_CODE_OAUTH_TOKEN);
    if (token === undefined) return [];
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.execute(
      HttpClientRequest.get(CLAUDE_USAGE_ENDPOINT).pipe(
        HttpClientRequest.bearerToken(token),
        HttpClientRequest.setHeader("accept", "application/json"),
        HttpClientRequest.setHeader("anthropic-beta", "oauth-2025-04-20"),
      ),
    );
    if (response.status < 200 || response.status >= 300) return [];
    return normalizeClaudeRateLimits(yield* response.json);
  }).pipe(
    Effect.timeoutOption(USAGE_QUERY_TIMEOUT_MS),
    Effect.map(Option.getOrElse(() => [] as ReadonlyArray<ProviderRateLimitWindow>)),
    Effect.orElseSucceed(() => []),
  );
