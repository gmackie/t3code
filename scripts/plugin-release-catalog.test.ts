// @effect-diagnostics nodeBuiltinImport:off - the test checks the staged resource file.
import * as NodeFS from "node:fs";

import { assert, it } from "@effect/vitest";

import {
  readPluginReleaseCatalog,
  stagePluginReleaseCatalog,
  validatePluginReleaseCatalog,
} from "./plugin-release-catalog.ts";

it("validates the checked-in release catalog", () => {
  const catalog = readPluginReleaseCatalog(process.cwd());
  assert.isAtLeast(catalog.plugins.length, 10);
  assert.isTrue(catalog.plugins.some((plugin) => plugin.id === "com.t3code.bob"));
  assert.isTrue(catalog.plugins.some((plugin) => plugin.id === "com.t3code.jujutsu"));
});

it("rejects duplicate ids and mutable sources", () => {
  assert.throws(
    () =>
      validatePluginReleaseCatalog({
        schemaVersion: 1,
        plugins: [
          {
            id: "com.t3code.example",
            displayName: "Example",
            version: "1.0.0",
            source: {
              kind: "git",
              url: "https://github.com/gmackie/t3code-example-plugin.git",
              commit: "main",
            },
            manifestPath: "t3-plugin.json",
          },
          {
            id: "com.t3code.example",
            displayName: "Example",
            version: "1.0.0",
            source: {
              kind: "git",
              url: "https://github.com/gmackie/t3code-example-plugin.git",
              commit: "0000000000000000000000000000000000000000",
            },
            manifestPath: "t3-plugin.json",
          },
        ],
      }),
    /full commit/u,
  );
});

it("stages a normalized catalog into desktop resources", () => {
  const root = `/tmp/t3code-plugin-catalog-${process.pid}`;
  const destination = stagePluginReleaseCatalog({
    repoRoot: process.cwd(),
    stageResourcesDir: root,
  });
  assert.equal(destination, `${root}/plugins/release-catalog.json`);
  assert.isTrue(NodeFS.statSync(destination).size > 0);
});
