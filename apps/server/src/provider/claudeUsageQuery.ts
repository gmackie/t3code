import * as NodeOS from "node:os";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import { collectStreamAsString } from "./providerSnapshot.ts";
import { normalizeClaudeRateLimits, type ProviderRateLimitWindow } from "./providerUsage.ts";

const CLAUDE_USAGE_ENDPOINT = "https://api.anthropic.com/api/oauth/usage";
const USAGE_QUERY_TIMEOUT_MS = 15_000;

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function claudeCredentialsFilePath(
  path: Path.Path,
  environment: NodeJS.ProcessEnv | undefined,
  homeDir = NodeOS.homedir(),
): string {
  const configDir = nonEmptyString(environment?.CLAUDE_CONFIG_DIR);
  return path.join(configDir ?? path.join(homeDir, ".claude"), ".credentials.json");
}

export function extractClaudeAccessToken(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const oauth = (value as Record<string, unknown>).claudeAiOauth;
  if (!oauth || typeof oauth !== "object") return undefined;
  return nonEmptyString((oauth as Record<string, unknown>).accessToken);
}

export function selectClaudeAccessToken(input: {
  readonly fileCredential: unknown;
  readonly environmentToken: unknown;
  readonly keychainCredential: string | undefined;
}): string | undefined {
  const keychainCredential = input.keychainCredential
    ? (() => {
        try {
          return JSON.parse(input.keychainCredential) as unknown;
        } catch {
          return undefined;
        }
      })()
    : undefined;
  return (
    nonEmptyString(input.environmentToken) ??
    extractClaudeAccessToken(input.fileCredential) ??
    extractClaudeAccessToken(keychainCredential)
  );
}

const readMacKeychainCredential: Effect.Effect<
  string | undefined,
  never,
  ChildProcessSpawner.ChildProcessSpawner
> = Effect.gen(function* () {
  if (process.platform !== "darwin") return undefined;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(
    ChildProcess.make(
      "/usr/bin/security",
      ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
      { extendEnv: true },
    ),
  );
  const [stdout, exitCode] = yield* Effect.all(
    [collectStreamAsString(child.stdout), child.exitCode.pipe(Effect.map(Number))],
    { concurrency: "unbounded" },
  );
  return exitCode === 0 ? stdout.trim() || undefined : undefined;
}).pipe(
  Effect.scoped,
  Effect.orElseSucceed(() => undefined),
);

const decodeUnknownJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));

export const queryClaudeUsageRateLimits = (
  environment?: NodeJS.ProcessEnv,
): Effect.Effect<
  ReadonlyArray<ProviderRateLimitWindow>,
  never,
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | HttpClient.HttpClient
  | Path.Path
> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const fileCredential = yield* fileSystem
      .readFileString(claudeCredentialsFilePath(path, environment))
      .pipe(
        Effect.flatMap(decodeUnknownJson),
        Effect.orElseSucceed(() => undefined),
      );
    const token = selectClaudeAccessToken({
      fileCredential,
      environmentToken: environment?.CLAUDE_CODE_OAUTH_TOKEN,
      keychainCredential: nonEmptyString(environment?.CLAUDE_CONFIG_DIR)
        ? undefined
        : yield* readMacKeychainCredential,
    });
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
