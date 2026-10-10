import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";

import { resolveUserDataPath } from "./DesktopUserData.ts";

it.effect("identifies a failed source read and preserves its cause", () => {
  const sourceState = "/profiles/t3code/Local State";
  const cause = PlatformError.systemError({
    _tag: "PermissionDenied",
    module: "FileSystem",
    method: "readFileString",
    pathOrDescriptor: sourceState,
  });
  return Effect.gen(function* () {
    const error = yield* resolveUserDataPath({
      appDataDirectory: "/profiles",
      isDevelopment: false,
      platform: "win32",
    }).pipe(Effect.flip);
    assert.equal(error.operation, "read");
    assert.equal(error.resourcePath, sourceState);
    assert.equal(error.category, "PermissionDenied");
    assert.strictEqual(error.cause, cause);
  }).pipe(
    Effect.provideService(
      FileSystem.FileSystem,
      FileSystem.makeNoop({
        exists: (path) => Effect.succeed(path === sourceState),
        readFileString: () => Effect.fail(cause),
      }),
    ),
    Effect.provide(NodeServices.layer),
  );
});

it.effect.each(["t3code", "T3 Code (Alpha)"])(
  "preserves Windows credential keys from %s without copying browser databases",
  (sourceName) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-v2-profile-" });
      const source = path.join(directory, sourceName);
      const destination = path.join(directory, "t3code-v2");
      const state = '{"os_crypt":{"encrypted_key":"test-encrypted-key"}}';
      yield* fs.makeDirectory(path.join(directory, "T3 Code (Alpha)"), { recursive: true });
      yield* fs.makeDirectory(path.join(source, "IndexedDB"), { recursive: true });
      yield* fs.writeFileString(path.join(source, "Local State"), state);
      yield* fs.writeFileString(path.join(source, "IndexedDB", "LOCK"), "V1 owns this database");
      yield* resolveUserDataPath({
        appDataDirectory: directory,
        isDevelopment: false,
        platform: "win32",
      });
      assert.equal(yield* fs.readFileString(path.join(destination, "Local State")), state);
      assert.equal(yield* fs.readFileString(path.join(source, "Local State")), state);
      assert.isFalse(yield* fs.exists(path.join(destination, "IndexedDB")));
      yield* fs.writeFileString(path.join(destination, "Local State"), "existing V2 state");
      yield* resolveUserDataPath({
        appDataDirectory: directory,
        isDevelopment: false,
        platform: "win32",
      });
      assert.equal(
        yield* fs.readFileString(path.join(destination, "Local State")),
        "existing V2 state",
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);

it.effect("keeps GMACKO builds on their own profile beside the official app", () =>
  Effect.gen(function* () {
    const resolve = (appVersion: string) =>
      resolveUserDataPath({
        appDataDirectory: "/profiles",
        isDevelopment: false,
        platform: "darwin",
        appVersion,
      });
    assert.equal(yield* resolve("0.0.45-gmacko.202610020902"), "/profiles/t3code-gmacko");
    assert.equal(yield* resolve("0.0.45"), "/profiles/t3code-v2");
  }).pipe(
    Effect.provideService(
      FileSystem.FileSystem,
      FileSystem.makeNoop({ exists: () => Effect.succeed(false) }),
    ),
    Effect.provide(NodeServices.layer),
  ),
);

it.effect.each(["darwin", "linux", "win32"] as const)(
  "selects an explicit %s profile without inspecting or migrating default credential stores",
  (platform) =>
    Effect.gen(function* () {
      const profile = yield* resolveUserDataPath({
        appDataDirectory: "/live-profile-parent",
        userDataDirectory: "/isolated/profile",
        appVersion: "0.0.45-gmacko.202610101637",
        isDevelopment: false,
        platform,
      });
      assert.equal(profile, "/isolated/profile");
    }).pipe(
      Effect.provideService(
        FileSystem.FileSystem,
        FileSystem.makeNoop({
          exists: () => Effect.die("explicit profiles must not inspect defaults"),
        }),
      ),
      Effect.provide(NodeServices.layer),
    ),
);
