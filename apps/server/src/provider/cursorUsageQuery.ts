/**
 * cursorUsageQuery — plan-usage lookup for the Cursor Agent CLI login.
 *
 * Cursor's ACP surface carries no quota data, so usage comes from the same
 * dashboard RPC the CLI's account surfaces use
 * (`aiserver.v1.DashboardService/GetCurrentPeriodUsage`), authenticated with
 * the CLI's stored login: the login keychain on macOS (written via
 * `/usr/bin/security`, so it is readable the same way without a UI prompt)
 * or `auth.json` in the CLI's config directory elsewhere.
 *
 * Every entry point degrades to "no usage data" instead of failing: a missing
 * login, an unreadable keychain, or a rejected request yields an empty window
 * list so provider usage simply stays unavailable.
 *
 * @module provider/cursorUsageQuery
 */
import * as NodeOS from "node:os";
import { DatabaseSync } from "node:sqlite";

import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import { collectStreamAsString } from "./providerSnapshot.ts";
import { normalizeCursorUsageRateLimits, type ProviderRateLimitWindow } from "./providerUsage.ts";

const CURSOR_USAGE_ENDPOINT =
  "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage";
const CURSOR_USAGE_SUMMARY_ENDPOINT = "https://cursor.com/api/usage-summary";
const CURSOR_KEYCHAIN_SERVICE = "cursor-access-token";
const CURSOR_KEYCHAIN_ACCOUNT = "cursor-user";
const USAGE_QUERY_TIMEOUT_MS = 15_000;

export function cursorAuthFilePath(
  path: Path.Path,
  platform: NodeJS.Platform,
  options?: {
    readonly environment?: NodeJS.ProcessEnv;
    readonly homeDir?: string;
  },
): string {
  const home = options?.homeDir ?? NodeOS.homedir();
  const env = options?.environment ?? process.env;
  switch (platform) {
    case "win32": {
      const appData = env.APPDATA?.trim();
      return path.join(
        appData && appData.length > 0 ? appData : path.join(home, "AppData", "Roaming"),
        "Cursor",
        "auth.json",
      );
    }
    case "darwin":
      return path.join(home, ".cursor", "auth.json");
    default: {
      const xdgConfig = env.XDG_CONFIG_HOME?.trim();
      return path.join(
        xdgConfig && xdgConfig.length > 0 ? xdgConfig : path.join(home, ".config"),
        "cursor",
        "auth.json",
      );
    }
  }
}

export function cursorStateDbPath(
  path: Path.Path,
  platform: NodeJS.Platform,
  options?: { readonly environment?: NodeJS.ProcessEnv; readonly homeDir?: string },
): string {
  const home = options?.homeDir ?? NodeOS.homedir();
  const env = options?.environment ?? process.env;
  const base =
    platform === "darwin"
      ? path.join(home, "Library", "Application Support")
      : platform === "win32"
        ? env.APPDATA?.trim() || path.join(home, "AppData", "Roaming")
        : env.XDG_CONFIG_HOME?.trim() || path.join(home, ".config");
  return path.join(base, "Cursor", "User", "globalStorage", "state.vscdb");
}

const decodeUnknownJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function cursorUserIdFromAccessToken(token: string): string | undefined {
  const payload = token.split(".")[1];
  if (payload === undefined) return undefined;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!decoded || typeof decoded !== "object") return undefined;
    return nonEmptyString((decoded as Record<string, unknown>).sub);
  } catch {
    return undefined;
  }
}

const readMacKeychainToken: Effect.Effect<
  string | undefined,
  never,
  ChildProcessSpawner.ChildProcessSpawner
> = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const command = ChildProcess.make(
    "/usr/bin/security",
    ["find-generic-password", "-s", CURSOR_KEYCHAIN_SERVICE, "-a", CURSOR_KEYCHAIN_ACCOUNT, "-w"],
    { extendEnv: true },
  );
  const child = yield* spawner.spawn(command);
  const [stdout, _stderr, exitCode] = yield* Effect.all(
    [
      collectStreamAsString(child.stdout),
      collectStreamAsString(child.stderr),
      child.exitCode.pipe(Effect.map(Number)),
    ],
    { concurrency: "unbounded" },
  );
  if (exitCode !== 0) return undefined;
  return nonEmptyString(stdout);
}).pipe(
  Effect.scoped,
  Effect.orElseSucceed(() => undefined),
);

const readAuthFileToken = (
  environment?: NodeJS.ProcessEnv,
): Effect.Effect<string | undefined, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const platform = yield* HostProcessPlatform;
    const contents = yield* fileSystem.readFileString(
      cursorAuthFilePath(path, platform, environment ? { environment } : undefined),
    );
    const parsed = yield* decodeUnknownJson(contents);
    if (!parsed || typeof parsed !== "object") return undefined;
    const record = parsed as Record<string, unknown>;
    return nonEmptyString(record.accessToken) ?? nonEmptyString(record.apiKey);
  }).pipe(Effect.orElseSucceed(() => undefined));

const readCursorStateToken = (
  environment?: NodeJS.ProcessEnv,
): Effect.Effect<string | undefined, never, Path.Path> =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const platform = yield* HostProcessPlatform;
    return yield* Effect.try({
      try: () => {
        const database = new DatabaseSync(
          cursorStateDbPath(path, platform, environment ? { environment } : undefined),
          { readOnly: true },
        );
        try {
          const row = database
            .prepare("SELECT value FROM ItemTable WHERE key = ?")
            .get("cursorAuth/accessToken") as { value?: unknown } | undefined;
          return nonEmptyString(row?.value);
        } finally {
          database.close();
        }
      },
      catch: () => undefined,
    });
  }).pipe(Effect.orElseSucceed(() => undefined));

export const resolveCursorAccessToken = (
  environment?: NodeJS.ProcessEnv,
): Effect.Effect<
  string | undefined,
  never,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function* () {
    const apiKey = nonEmptyString(environment?.CURSOR_API_KEY);
    if (apiKey !== undefined) return apiKey;
    const stateToken = yield* readCursorStateToken(environment);
    if (stateToken !== undefined) return stateToken;
    if ((yield* HostProcessPlatform) === "darwin") {
      const keychainToken = yield* readMacKeychainToken;
      if (keychainToken !== undefined) return keychainToken;
    }
    return yield* readAuthFileToken(environment);
  });

export const queryCursorUsageRateLimits = (
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
    const token = yield* resolveCursorAccessToken(environment);
    if (token === undefined) return [];
    const client = yield* HttpClient.HttpClient;
    const userId = cursorUserIdFromAccessToken(token);
    if (userId !== undefined) {
      const summaryResponse = yield* client.execute(
        HttpClientRequest.get(CURSOR_USAGE_SUMMARY_ENDPOINT).pipe(
          HttpClientRequest.setHeader("accept", "application/json"),
          HttpClientRequest.setHeader("cookie", `WorkosCursorSessionToken=${userId}::${token}`),
        ),
      );
      if (summaryResponse.status >= 200 && summaryResponse.status < 300) {
        const windows = normalizeCursorUsageRateLimits(yield* summaryResponse.json);
        if (windows.length > 0) return windows;
      }
    }
    const request = HttpClientRequest.post(CURSOR_USAGE_ENDPOINT).pipe(
      HttpClientRequest.bearerToken(token),
      HttpClientRequest.setHeader("accept", "application/json"),
      HttpClientRequest.bodyJsonUnsafe({}),
    );
    const response = yield* client.execute(request);
    if (response.status < 200 || response.status >= 300) return [];
    const payload = yield* response.json;
    return normalizeCursorUsageRateLimits(payload);
  }).pipe(
    Effect.timeoutOption(USAGE_QUERY_TIMEOUT_MS),
    Effect.map(Option.getOrElse(() => [] as ReadonlyArray<ProviderRateLimitWindow>)),
    Effect.orElseSucceed(() => []),
  );
