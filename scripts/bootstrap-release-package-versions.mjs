#!/usr/bin/env node

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const version = process.argv[2];
if (!version) {
  throw new Error("A release version is required.");
}

const releasePackageFiles = [
  "apps/server/package.json",
  "apps/desktop/package.json",
  "apps/web/package.json",
  "packages/contracts/package.json",
];

for (const relativePath of releasePackageFiles) {
  const filePath = NodePath.resolve(relativePath);
  const manifest = JSON.parse(NodeFS.readFileSync(filePath, "utf8"));
  if (manifest.version === version) {
    continue;
  }

  manifest.version = version;
  NodeFS.writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`);
}
