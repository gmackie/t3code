// T3 Code Locked bundle audit: the lockdown guards are built in, no cloud key, relay URL or update
// feed was baked in, and (with --packaged) the app has no electron-updater feed.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const root = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");

const fail = (message) => {
  process.stderr.write(`verify-locked-build: ${message}\n`);
  process.exit(1);
};

async function listFiles(directory) {
  const entries = await NodeFSP.readdir(directory, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => NodePath.join(entry.parentPath ?? entry.path, entry.name));
}

const packagedIndex = process.argv.indexOf("--packaged");
if (packagedIndex !== -1) {
  const resources = process.argv[packagedIndex + 1];
  if (!resources) fail("--packaged needs the app's resources directory");
  const files = await listFiles(resources);
  const feed = files.find((file) => NodePath.basename(file) === "app-update.yml");
  if (feed) fail(`packaged app has an update feed: ${NodePath.relative(resources, feed)}`);
  process.stdout.write(JSON.stringify({ packaged: resources, updateFeed: null }) + "\n");
  process.exit(0);
}

// Each bundle must contain the guard that keeps it local.
const markers = [
  { directory: "apps/server/dist", pattern: /t3code-locked/, what: "locked identity" },
  {
    directory: "apps/server/dist",
    pattern: /T3 Code Locked blocked a request/,
    what: "egress guard",
  },
  { directory: "apps/desktop/dist-electron", pattern: /t3code-locked/, what: "locked identity" },
  {
    directory: "apps/desktop/dist-electron",
    pattern: /T3 Code Locked blocked a request/,
    what: "egress guard",
  },
];
// Nothing a build environment can bake in that would point the app at a cloud service.
const forbidden = [
  { pattern: /pk_(?:live|test)_[A-Za-z0-9]{8,}/, what: "a Clerk publishable key" },
  { pattern: /(?:wss?|https):\/\/relay\.t3\.codes/, what: "the T3 Connect relay URL" },
];

const inventory = [];
const contents = new Map();
for (const directory of ["apps/server/dist", "apps/desktop/dist-electron"]) {
  const absolute = NodePath.resolve(root, directory);
  let files;
  try {
    files = await listFiles(absolute);
  } catch {
    fail(`build ${directory} before checking it`);
  }
  const scripts = files.filter((file) => /\.(?:mjs|cjs|js)$/.test(file));
  if (scripts.length === 0) fail(`${directory} has no bundles`);
  const text = [];
  for (const file of scripts) {
    const content = await NodeFSP.readFile(file);
    text.push(content.toString("utf8"));
    inventory.push({
      file: NodePath.relative(root, file),
      bytes: content.length,
      sha256: NodeCrypto.createHash("sha256").update(content).digest("hex"),
    });
  }
  contents.set(directory, text.join("\n"));
}
for (const marker of markers) {
  if (!marker.pattern.test(contents.get(marker.directory) ?? "")) {
    fail(`${marker.directory} is missing the ${marker.what}; this is not a locked build`);
  }
}
for (const [directory, text] of contents) {
  for (const { pattern, what } of forbidden) {
    if (pattern.test(text)) fail(`${directory} has ${what} baked in`);
  }
}
process.stdout.write(
  JSON.stringify(
    {
      edition: "T3 Code Locked",
      validation: "lockdown markers, no baked cloud configuration",
      artifacts: inventory.sort((a, b) => a.file.localeCompare(b.file)),
    },
    null,
    2,
  ) + "\n",
);
