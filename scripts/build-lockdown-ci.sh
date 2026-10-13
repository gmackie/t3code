#!/usr/bin/env bash
set -euo pipefail
platform="${1:?platform required}"
arch="${2:?architecture required}"
output="${3:?output directory required}"
case "$platform/$arch" in
  mac/arm64|mac/x64|linux/x64) ;;
  *) echo "Unsupported locked desktop target: $platform/$arch" >&2; exit 1 ;;
esac
repo_dir="$PWD"
# Build explicitly so the audit examines the exact inputs used by the packager.
(cd apps/server && pnpm exec vp pack)
(cd apps/web && pnpm exec vp build)
(cd apps/desktop && node scripts/build-browser-secret.mjs && node scripts/build-preview-annotation-css.mjs && pnpm exec vp pack)
mkdir -p "$output"
node scripts/verify-locked-build.mjs > "$output/bundle-inventory-$platform-$arch.json"
cp -R apps/web/dist apps/server/dist/client
export PATH="$repo_dir/node_modules/.bin:$PATH"
export CSC_IDENTITY_AUTO_DISCOVERY=false
if [[ "$platform" == mac ]]; then
  node scripts/build-desktop-artifact.ts --platform mac --target dir --arch "$arch" \
    --skip-build --output-dir "$output" --verbose
  ditto -c -k --sequesterRsrc --keepParent "$output/mac-$arch/T3 Code Locked.app" \
    "$output/T3-Code-Locked-macos-$arch-unsigned.zip"
  rm -rf "$output/mac-$arch"
else
  export APPIMAGE_EXTRACT_AND_RUN=1
  node scripts/build-desktop-artifact.ts --platform linux --target AppImage --arch "$arch" \
    --skip-build --output-dir "$output" --verbose
fi
node --input-type=module - "$output" "$platform" "$arch" <<'JS'
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
const [directory, platform, arch] = process.argv.slice(2);
const files = (await fs.readdir(directory)).filter(name => /\.(zip|AppImage)$/.test(name));
if (!files.length) throw new Error("No desktop artifacts produced");
const sums = [];
for (const name of files.sort()) {
  const content = await fs.readFile(path.join(directory, name));
  sums.push(`${crypto.createHash("sha256").update(content).digest("hex")}  ${name}`);
}
await fs.writeFile(path.join(directory, `SHA256SUMS-${platform}-${arch}`), sums.join("\n") + "\n");
JS
