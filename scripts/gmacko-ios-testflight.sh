#!/usr/bin/env bash
# Build the GMACKO iOS app (com.gmacko.t3code) and upload it to TestFlight.
#
# Runs on a Mac with Xcode and CocoaPods. Signing is Xcode automatic signing
# driven by an App Store Connect API key (Admin role), so the first run also
# registers the app, widget, and share-extension identifiers and the app group.
#
# Required environment:
#   APPLE_TEAM_ID         Developer team that owns com.gmacko.t3code
#   APPLE_API_KEY_PATH    Path to the App Store Connect .p8 key
#   APPLE_API_KEY_ID      Key ID
#   APPLE_API_ISSUER      Issuer ID
#   BUILD_NUMBER          Monotonically increasing CFBundleVersion, e.g. 202610010733
set -euo pipefail

for name in APPLE_TEAM_ID APPLE_API_KEY_PATH APPLE_API_KEY_ID APPLE_API_ISSUER BUILD_NUMBER; do
  if [[ -z "${!name:-}" ]]; then
    echo "$name is required." >&2
    exit 1
  fi
done
if [[ ! "$BUILD_NUMBER" =~ ^[0-9]+$ ]]; then
  echo "BUILD_NUMBER must be numeric; got '$BUILD_NUMBER'." >&2
  exit 1
fi
command -v pod >/dev/null || {
  echo "CocoaPods is required (brew install cocoapods)." >&2
  exit 1
}

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mobile_dir="$repo_root/apps/mobile"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/gmacko-ios.XXXXXX")"
# macOS runners share one workspace: never leave a generated project behind.
cleanup() {
  rm -rf "$work_dir" "$mobile_dir/ios"
}
trap cleanup EXIT

export APP_VARIANT=gmacko
export T3CODE_IOS_TEAM_ID="$APPLE_TEAM_ID"
export T3CODE_IOS_BUILD_NUMBER="$BUILD_NUMBER"
# Upstream's EAS update channel must never reach this binary.
export T3CODE_MOBILE_UPDATES_ENABLED=0
export EXPO_NO_GIT_STATUS=1

cd "$mobile_dir"
pnpm exec expo prebuild --clean --platform ios

workspace="$(find ios -maxdepth 1 -name '*.xcworkspace' | head -n 1)"
if [[ -z "$workspace" ]]; then
  echo "expo prebuild did not produce an Xcode workspace." >&2
  exit 1
fi
scheme="$(basename "$workspace" .xcworkspace)"

auth_args=(
  -allowProvisioningUpdates
  -authenticationKeyPath "$APPLE_API_KEY_PATH"
  -authenticationKeyID "$APPLE_API_KEY_ID"
  -authenticationKeyIssuerID "$APPLE_API_ISSUER"
)

xcodebuild archive \
  -workspace "$workspace" \
  -scheme "$scheme" \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "$work_dir/$scheme.xcarchive" \
  DEVELOPMENT_TEAM="$APPLE_TEAM_ID" \
  "${auth_args[@]}"

cat >"$work_dir/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store-connect</string>
  <key>destination</key>
  <string>upload</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>teamID</key>
  <string>${APPLE_TEAM_ID}</string>
  <key>manageAppVersionAndBuildNumber</key>
  <false/>
</dict>
</plist>
PLIST

xcodebuild -exportArchive \
  -archivePath "$work_dir/$scheme.xcarchive" \
  -exportOptionsPlist "$work_dir/ExportOptions.plist" \
  -exportPath "$work_dir/export" \
  "${auth_args[@]}"

echo "Uploaded com.gmacko.t3code build $BUILD_NUMBER to App Store Connect."
