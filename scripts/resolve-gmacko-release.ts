#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Config, Effect, FileSystem, Option, Path, Schema } from "effect";
import { Command, Flag } from "effect/unstable/cli";

interface GmackoReleaseMetadata {
  readonly baseVersion: string;
  readonly version: string;
  readonly tag: string;
  readonly name: string;
}

const StampSchema = Schema.String.check(Schema.isPattern(/^\d{12}$/));
const DesktopPackageJsonSchema = Schema.Struct({
  version: Schema.NonEmptyString,
});

const RepoRoot = Effect.service(Path.Path).pipe(
  Effect.flatMap((path) => path.fromFileUrl(new URL("..", import.meta.url))),
);
const decodeDesktopPackageJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(DesktopPackageJsonSchema),
);

export const resolveGmackoBaseVersion = (version: string) => {
  const stableCore = version.replace(/[-+].*$/, "");
  if (!/^\d+\.\d+\.\d+$/.test(stableCore)) {
    throw new Error(`Invalid desktop package version '${version}'.`);
  }
  return stableCore;
};

export const resolveGmackoReleaseMetadata = (
  baseVersion: string,
  stamp: string,
): GmackoReleaseMetadata => {
  const version = `${baseVersion}-gmacko.${stamp}`;
  return {
    baseVersion,
    version,
    tag: `v${version}`,
    name: `T3 Code (gmacko) ${version}`,
  };
};

const readDesktopBaseVersion = Effect.fn("readDesktopBaseVersion")(function* (
  rootDir: string | undefined,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspaceRoot = rootDir ? path.resolve(rootDir) : yield* RepoRoot;
  const packageJsonPath = path.join(workspaceRoot, "apps/desktop/package.json");
  const packageJson = yield* fs
    .readFileString(packageJsonPath)
    .pipe(Effect.flatMap(decodeDesktopPackageJson));
  return resolveGmackoBaseVersion(packageJson.version);
});

const writeOutput = Effect.fn("writeOutput")(function* (
  metadata: GmackoReleaseMetadata,
  writeGithubOutput: boolean,
) {
  const fs = yield* FileSystem.FileSystem;

  const entries = [
    ["base_version", metadata.baseVersion],
    ["version", metadata.version],
    ["tag", metadata.tag],
    ["name", metadata.name],
  ] as const;

  if (writeGithubOutput) {
    const githubOutputPath = yield* Config.nonEmptyString("GITHUB_OUTPUT");
    const serialized = entries.map(([key, value]) => `${key}=${value}\n`).join("");
    yield* fs.writeFileString(githubOutputPath, serialized, { flag: "a" });
  } else {
    for (const [key, value] of entries) {
      console.log(`${key}=${value}`);
    }
  }
});

const command = Command.make(
  "resolve-gmacko-release",
  {
    stamp: Flag.string("stamp").pipe(
      Flag.withSchema(StampSchema),
      Flag.withDescription("Gmacko release timestamp in YYYYMMDDHHMM UTC."),
    ),
    githubOutput: Flag.boolean("github-output").pipe(
      Flag.withDescription("Write values to GITHUB_OUTPUT instead of stdout."),
      Flag.withDefault(false),
    ),
    root: Flag.string("root").pipe(
      Flag.withDescription("Workspace root used to resolve apps/desktop/package.json."),
      Flag.optional,
    ),
  },
  ({ stamp, githubOutput, root }) =>
    readDesktopBaseVersion(Option.getOrUndefined(root)).pipe(
      Effect.map((baseVersion) => resolveGmackoReleaseMetadata(baseVersion, stamp)),
      Effect.flatMap((metadata) => writeOutput(metadata, githubOutput)),
    ),
).pipe(Command.withDescription("Resolve gmacko release version metadata."));

if (import.meta.main) {
  Command.run(command, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
