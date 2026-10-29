// @effect-diagnostics nodeBuiltinImport:off - Release bootstrap verifies Expo's embedded public configuration before upload.
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

function atPath(config: unknown, ...keys: string[]): unknown {
  let value = config;
  for (const key of keys) {
    if (typeof value !== "object" || value === null || !(key in value)) return undefined;
    value = Reflect.get(value, key);
  }
  return value;
}

export function verifyGmackoMobileConfig(config: unknown): void {
  NodeAssert.equal(atPath(config, "ios", "bundleIdentifier"), "com.gmacko.t3code");
  NodeAssert.equal(
    atPath(config, "updates", "enabled"),
    false,
    "GMACKO must not receive upstream OTA updates",
  );
  const publishableKey = atPath(config, "extra", "clerk", "publishableKey");
  const jwtTemplate = atPath(config, "extra", "clerk", "jwtTemplate");
  const relayUrl = atPath(config, "extra", "relay", "url");
  NodeAssert.ok(
    typeof publishableKey === "string" && publishableKey.startsWith("pk_live_"),
    "GMACKO requires the production Clerk publishable key",
  );
  NodeAssert.ok(
    typeof jwtTemplate === "string" && jwtTemplate.trim(),
    "GMACKO requires the Clerk JWT template",
  );
  NodeAssert.ok(
    typeof relayUrl === "string" && new URL(relayUrl).protocol === "https:",
    "GMACKO requires an HTTPS relay URL",
  );
}

if (
  process.argv[1] &&
  NodePath.resolve(process.argv[1]) === NodeURL.fileURLToPath(import.meta.url)
) {
  const appPath = process.argv[2];
  const config: unknown = appPath
    ? JSON.parse(
        NodeFS.readFileSync(NodePath.join(appPath, "EXConstants.bundle", "app.config"), "utf8"),
      )
    : (await import("../apps/mobile/app.config.ts")).default;
  verifyGmackoMobileConfig(config);
  process.stdout.write(
    `Verified GMACKO mobile T3 Connect configuration${appPath ? " in archived app" : " before build"}.\n`,
  );
}
