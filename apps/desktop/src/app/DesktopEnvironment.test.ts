import * as NodePath from "@effect/platform-node/NodePath";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopConfig from "./DesktopConfig.ts";

const defaultInput = {
  dirname: "/repo/apps/desktop/dist-electron",
  homeDirectory: "/Users/alice",
  platform: "darwin",
  processArch: "arm64",
  appVersion: "0.0.22",
  appPath: "/Applications/T3 Code.app/Contents/Resources/app.asar",
  isPackaged: false,
  resourcesPath: "/Applications/T3 Code.app/Contents/Resources",
  runningUnderArm64Translation: false,
} satisfies DesktopEnvironment.MakeDesktopEnvironmentInput;

const layerEnvironment = (
  overrides: Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> = {},
  env: Record<string, string | undefined> = {},
) =>
  DesktopEnvironment.layer({
    ...defaultInput,
    ...overrides,
  }).pipe(
    Layer.provide(
      Layer.mergeAll(NodeServices.layer, NodePath.layerPosix, DesktopConfig.layerTest(env)),
    ),
  );

const makeEnvironment = (
  overrides: Partial<DesktopEnvironment.MakeDesktopEnvironmentInput> = {},
  env: Record<string, string | undefined> = {},
) => DesktopEnvironment.DesktopEnvironment.pipe(Effect.provide(layerEnvironment(overrides, env)));

describe("DesktopEnvironment", () => {
  it.effect("uses the packaged Windows server sidecar as the backend root", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment({
        platform: "win32",
        isPackaged: true,
        appPath: "/install/resources/app.asar",
        resourcesPath: "/install/resources",
      });

      assert.equal(environment.appRoot, "/install/resources/app.asar");
      assert.equal(environment.serverRoot, "/install/resources/server.asar");
      assert.equal(
        environment.backendEntryPath,
        "/install/resources/server.asar/apps/server/dist/bin.mjs",
      );
      assert.equal(
        environment.clientAssetsDir,
        "/install/resources/server.asar/apps/server/dist/client",
      );
    }),
  );

  it.effect("keeps implicit development state separate from production state", () =>
    Effect.gen(function* () {
      const development = yield* makeEnvironment(
        {},
        { VITE_DEV_SERVER_URL: "http://localhost:5173" },
      );
      const production = yield* makeEnvironment();

      assert.equal(development.stateDir, "/Users/alice/.t3/dev");
      assert.equal(production.stateDir, "/Users/alice/.t3/userdata");
    }),
  );

  it.effect("derives packaged gmacko identity and state paths", () =>
    Effect.gen(function* () {
      const environment = yield* makeEnvironment({
        appVersion: "0.0.24-gmacko.202606050307",
        isPackaged: true,
        appPath: "/Applications/T3 Code (gmacko).app/Contents/Resources/app.asar",
        resourcesPath: "/Applications/T3 Code (gmacko).app/Contents/Resources",
      });

      assert.equal(environment.displayName, "T3 Code (gmacko)");
      assert.equal(environment.baseDir, "/Users/alice/.t3-gmacko");
      assert.equal(environment.stateDir, "/Users/alice/.t3-gmacko/userdata-gmacko");
      assert.equal(
        environment.serverSettingsPath,
        "/Users/alice/.t3-gmacko/userdata-gmacko/settings.json",
      );
      assert.equal(environment.appUserModelId, "com.gmacko.t3code");
      assert.equal(environment.linuxDesktopEntryName, "t3code-gmacko.desktop");
      assert.equal(environment.linuxWmClass, "t3code-gmacko");
    }),
  );
});

it.effect("keeps an explicit Electron profile separate from T3 server state", () =>
  Effect.gen(function* () {
    const environment = yield* makeEnvironment(
      {},
      {
        T3CODE_HOME: "/isolated/server-state",
        T3CODE_DESKTOP_USER_DATA_DIR: " /isolated/electron-profile ",
      },
    );
    assert.equal(environment.userDataDirectory, "/isolated/electron-profile");
    assert.equal(environment.stateDir, "/isolated/server-state/userdata");
    assert.equal(environment.appDataDirectory, "/Users/alice/Library/Application Support");
  }),
);

it.effect.each(["relative/profile", "~/profile"])(
  "rejects a nonabsolute Electron profile %s before service construction",
  (userDataDirectory) =>
    Effect.gen(function* () {
      const error = yield* makeEnvironment(
        {},
        {
          T3CODE_DESKTOP_USER_DATA_DIR: userDataDirectory,
        },
      ).pipe(Effect.flip);
      assert.equal(error._tag, "ConfigError");
      assert.include(error.message, "must be an absolute path");
    }),
);

it.effect("ignores a blank Electron profile override", () =>
  Effect.gen(function* () {
    const environment = yield* makeEnvironment({}, { T3CODE_DESKTOP_USER_DATA_DIR: "   " });
    assert.equal(environment.userDataDirectory, undefined);
  }),
);
