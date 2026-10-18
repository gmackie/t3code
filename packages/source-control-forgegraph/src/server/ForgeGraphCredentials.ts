import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as SourceControlHost from "@t3tools/source-control-core/server/SourceControlHost";
import { readSourceControlHostSettings } from "@t3tools/source-control-core/client/definition";

import * as ForgeGraphClient from "../client/definition.ts";
import { DEFAULT_FORGEGRAPH_SERVER, forgeGraphServerOrigin } from "./forgeGraphHosts.ts";

/** How long the forge CLI's credentials file is reused before it is read again. */
const FILE_TTL = Duration.seconds(30);

export type ForgeGraphCredentialSource = "settings" | "env" | "forge-cli";

export interface ForgeGraphCredential {
  readonly server: string;
  readonly token: Redacted.Redacted<string>;
  readonly source: ForgeGraphCredentialSource;
}

/** No token for the server in Settings, `FG_API_TOKEN`, or the forge CLI's login. */
export class ForgeGraphNotSignedInError extends Schema.TaggedError<ForgeGraphNotSignedInError>()(
  "ForgeGraphNotSignedInError",
  { server: Schema.String },
) {
  override get message(): string {
    return `Not signed in to ForgeGraph at ${this.server}. Sign in from Settings → Source Control, set FG_API_TOKEN, or run \`forge login\` on the server.`;
  }
}

/** Where ForgeGraph tokens come from. Callers never see which source answered beyond `source`. */
export class ForgeGraphCredentials extends Context.Service<
  ForgeGraphCredentials,
  {
    /** The server ForgeGraph is read from, signed in or not. */
    readonly server: Effect.Effect<string>;
    readonly get: Effect.Effect<ForgeGraphCredential, ForgeGraphNotSignedInError>;
    /** Forgets the forge CLI's file after ForgeGraph refused a token, so a re-login applies. */
    readonly invalidate: Effect.Effect<void>;
  }
>()("@t3tools/source-control-forgegraph/server/ForgeGraphCredentials") {}

const CliCredentials = Schema.Struct({
  token: Schema.optional(Schema.String),
  server: Schema.optional(Schema.String),
});
const decodeCliCredentials = Schema.decodeUnknownOption(Schema.fromJsonString(CliCredentials));

interface Candidate {
  readonly token: string | null | undefined;
  /** The server this source's token was issued by. */
  readonly server: string | null;
  readonly source: ForgeGraphCredentialSource;
}

/**
 * Which server to use and which token to send it. The server is the first of Settings,
 * `FG_SERVER`, the forge CLI's, and forgegraf.com. Each token is only ever sent to the server its
 * own source names, so a production login is never handed to a server configured in Settings.
 */
export function resolveForgeGraphCredential(input: {
  readonly settings: ForgeGraphClient.ForgeGraphSettings;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cli: typeof CliCredentials.Type | null;
}):
  | { readonly server: string; readonly credential: ForgeGraphCredential }
  | { readonly server: string; readonly credential: null } {
  const envServer = forgeGraphServerOrigin(input.env.FG_SERVER);
  const cliServer = forgeGraphServerOrigin(input.cli?.server);
  const server =
    forgeGraphServerOrigin(input.settings.serverUrl) ??
    envServer ??
    cliServer ??
    DEFAULT_FORGEGRAPH_SERVER;
  const candidates: ReadonlyArray<Candidate> = [
    { token: input.settings.token, server, source: "settings" },
    {
      token: input.env.FG_API_TOKEN,
      server: envServer ?? DEFAULT_FORGEGRAPH_SERVER,
      source: "env",
    },
    {
      token: input.cli?.token,
      server: cliServer ?? DEFAULT_FORGEGRAPH_SERVER,
      source: "forge-cli",
    },
  ];
  const chosen = candidates.find(
    (candidate) => candidate.server === server && (candidate.token?.trim() ?? "").length > 0,
  );
  return chosen === undefined
    ? { server, credential: null }
    : {
        server,
        credential: {
          server,
          token: Redacted.make(chosen.token!.trim()),
          source: chosen.source,
        },
      };
}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const sourceControlHost = yield* SourceControlHost.SourceControlHost;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const environment = yield* HostProcess.Environment;
  const home = yield* HostProcess.HomeDirectory;
  const credentialsFile = path.join(home, ".forgegraph", "credentials.json");

  // Read-only: the forge CLI owns this file, and a missing or unreadable one is no login.
  const cliFile = yield* Cache.make({
    capacity: 1,
    timeToLive: FILE_TTL,
    lookup: () =>
      fileSystem.readFileString(credentialsFile).pipe(
        Effect.map((text) => Option.getOrNull(decodeCliCredentials(text))),
        Effect.orElseSucceed(() => null),
      ),
  });

  // Settings are read fresh, so signing in or out applies to the next request.
  const savedSettings = sourceControlHost.settings.get.pipe(
    Effect.map((settings) =>
      readSourceControlHostSettings(
        ForgeGraphClient.settings,
        settings.sourceControlHosts[ForgeGraphClient.definition.kind],
      ),
    ),
    Effect.orElseSucceed(() => readSourceControlHostSettings(ForgeGraphClient.settings, {})),
  );

  const resolve = Effect.all({ settings: savedSettings, cli: Cache.get(cliFile, "file") }).pipe(
    Effect.map(({ settings, cli }) =>
      resolveForgeGraphCredential({ settings, env: environment, cli }),
    ),
  );

  return ForgeGraphCredentials.of({
    server: resolve.pipe(Effect.map((resolved) => resolved.server)),
    get: resolve.pipe(
      Effect.flatMap((resolved) =>
        resolved.credential === null
          ? Effect.fail(new ForgeGraphNotSignedInError({ server: resolved.server }))
          : Effect.succeed(resolved.credential),
      ),
    ),
    invalidate: Cache.invalidate(cliFile, "file"),
  });
});

export const layer = Layer.effect(ForgeGraphCredentials, make);
