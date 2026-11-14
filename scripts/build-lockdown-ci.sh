#!/usr/bin/env bash
set -euo pipefail
platform="${1:?platform required}"
arch="${2:?architecture required}"
output="${3:?output directory required}"
case "$platform/$arch" in
  mac/arm64|mac/x64|linux/x64) ;;
  *) echo "Unsupported locked desktop target: $platform/$arch" >&2; exit 1 ;;
esac
# A locked build bakes in no cloud endpoints, keys or update feed, whatever the runner exports.
unset T3CODE_CLERK_PUBLISHABLE_KEY T3CODE_CLERK_JWT_TEMPLATE T3CODE_CLERK_CLI_OAUTH_CLIENT_ID \
  T3CODE_RELAY_URL T3CODE_HOSTED_APP_URL T3CODE_CLERK_PASSKEY_RP_DOMAINS \
  T3CODE_RELAY_CLIENT_OTLP_TRACES_URL T3CODE_RELAY_CLIENT_OTLP_TRACES_DATASET \
  T3CODE_RELAY_CLIENT_OTLP_TRACES_TOKEN VITE_CLERK_PUBLISHABLE_KEY VITE_CLERK_JWT_TEMPLATE \
  VITE_T3CODE_RELAY_URL VITE_RELAY_OTLP_TRACES_URL VITE_RELAY_OTLP_TRACES_DATASET \
  VITE_RELAY_OTLP_TRACES_TOKEN T3CODE_DESKTOP_UPDATE_REPOSITORY GITHUB_REPOSITORY
repo_dir="$PWD"
# Build explicitly so the audit examines the exact inputs the packager uses.
pnpm vp run build:desktop
mkdir -p "$output"
node scripts/verify-locked-build.mjs > "$output/bundle-inventory-$platform-$arch.json"
export PATH="$repo_dir/node_modules/.bin:$PATH"
export CSC_IDENTITY_AUTO_DISCOVERY=false
if [[ "$platform" == mac ]]; then
  node scripts/build-desktop-artifact.ts --platform mac --target dir --arch "$arch" \
    --skip-build --output-dir "$output" --verbose
  app="$(find "$output" -maxdepth 3 -name 'T3 Code Locked.app' -type d | head -n 1)"
  if [[ -z "$app" ]]; then
    echo "No T3 Code Locked.app was produced" >&2
    exit 1
  fi
  node scripts/verify-locked-build.mjs --packaged "$app/Contents/Resources" > /dev/null
  ditto -c -k --sequesterRsrc --keepParent "$app" "$output/T3-Code-Locked-macos-$arch-unsigned.zip"
  rm -rf "$(dirname "$app")"
else
  export APPIMAGE_EXTRACT_AND_RUN=1
  node scripts/build-desktop-artifact.ts --platform linux --target AppImage --arch "$arch" \
    --skip-build --output-dir "$output" --verbose
  unpacked="$(find "$output" -maxdepth 2 -type d -name 'linux-unpacked' | head -n 1)"
  if [[ -n "$unpacked" ]]; then
    node scripts/verify-locked-build.mjs --packaged "$unpacked/resources" > /dev/null
  fi
fi
node --input-type=module - "$output" "$platform" "$arch" <<'JS'
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
const [directory, platform, arch] = process.argv.slice(2);
const files = (await fs.readdir(directory)).filter((name) => /\.(zip|AppImage|deb)$/.test(name));
if (!files.length) throw new Error("No desktop artifacts produced");
const sums = [];
for (const name of files.sort()) {
  const content = await fs.readFile(path.join(directory, name));
  sums.push(`${crypto.createHash("sha256").update(content).digest("hex")}  ${name}`);
}
await fs.writeFile(path.join(directory, `SHA256SUMS-${platform}-${arch}`), sums.join("\n") + "\n");
JS
