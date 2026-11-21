#!/usr/bin/env bash
set -euo pipefail
platform="${1:?platform required}"
arch="${2:?architecture required}"
output="${3:?output directory required}"
# Optional release version (for example 0.1.11-locked.202611210900); defaults to the package version.
version="${4:-}"
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
artifact_args=(--skip-build --output-dir "$output" --verbose)
if [[ -n "$version" ]]; then
  artifact_args+=(--build-version "$version")
fi
signed=false
if [[ "$platform" == mac && "${LOCKDOWN_MAC_SIGNING:-off}" == required ]]; then
  # Developer ID signing plus notarization; electron-builder notarizes when the API key is set.
  for name in CSC_LINK CSC_KEY_PASSWORD APPLE_API_KEY APPLE_API_KEY_ID APPLE_API_ISSUER; do
    if [[ -z "${!name:-}" ]]; then
      echo "macOS signing is required but $name is not set" >&2
      exit 1
    fi
  done
  if [[ "$APPLE_API_KEY" != /* ]]; then
    key_path="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/AuthKey_${APPLE_API_KEY_ID}.p8"
    printf '%s' "$APPLE_API_KEY" > "$key_path"
    export APPLE_API_KEY="$key_path"
  fi
  export CSC_IDENTITY_AUTO_DISCOVERY=true
  artifact_args+=(--signed)
  signed=true
fi
if [[ "$platform" == mac ]]; then
  node scripts/build-desktop-artifact.ts --platform mac --target dir --arch "$arch" \
    "${artifact_args[@]}"
  app="$(find "$output" -maxdepth 3 -name 'T3 Code Locked.app' -type d | head -n 1)"
  if [[ -z "$app" ]]; then
    echo "No T3 Code Locked.app was produced" >&2
    exit 1
  fi
  node scripts/verify-locked-build.mjs --packaged "$app/Contents/Resources" > /dev/null
  suffix=unsigned
  if [[ "$signed" == true ]]; then
    codesign --verify --deep --strict --verbose=2 "$app"
    xcrun stapler validate "$app"
    spctl --assess --type execute --verbose=2 "$app"
    suffix=signed
  fi
  ditto -c -k --sequesterRsrc --keepParent "$app" \
    "$output/T3-Code-Locked-${version:+$version-}macos-$arch-$suffix.zip"
  rm -rf "$(dirname "$app")"
else
  export APPIMAGE_EXTRACT_AND_RUN=1
  node scripts/build-desktop-artifact.ts --platform linux --target AppImage --arch "$arch" \
    "${artifact_args[@]}"
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
