#!/usr/bin/env bash
# Build the GMACKO iOS app (com.gmacko.t3code) and upload it to TestFlight.
#
# Runs on a Mac with Xcode and CocoaPods. Signing is manual: xcodebuild's
# automatic provisioning with an API key is refused by the developer portal,
# so scripts/gmacko-ios-profiles.ts mints App Store profiles through the public
# App Store Connect API and the Apple Distribution identity comes from a
# host-local keychain.
#
# Host setup (once, on the build Mac):
#   ~/Library/Keychains/gmacko-ios-signing.keychain-db  Apple Distribution identity
#   ~/.gmacko-ios-signing/keychain-pass                  that keychain's password
# App IDs com.gmacko.t3code{,.widgets,.sharing} must exist with their
# capabilities and the group.com.gmacko.t3code App Group assigned.
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

keychain="${GMACKO_IOS_KEYCHAIN:-$HOME/Library/Keychains/gmacko-ios-signing.keychain-db}"
keychain_pass_file="${GMACKO_IOS_KEYCHAIN_PASS_FILE:-$HOME/.gmacko-ios-signing/keychain-pass}"
if [[ ! -f "$keychain" || ! -f "$keychain_pass_file" ]]; then
  echo "Signing keychain $keychain or its password file is missing; see the header of this script." >&2
  exit 1
fi
security unlock-keychain -p "$(cat "$keychain_pass_file")" "$keychain"
# Other jobs (electron-builder) rewrite the search list; codesign needs ours on it.
security list-keychains -d user -s "$keychain" $(security list-keychains -d user | tr -d '"' | grep -v "$keychain")
identity="$(security find-identity -v -p codesigning "$keychain" | awk '/Apple Distribution/ { print $2; exit }')"
if [[ -z "$identity" ]]; then
  echo "No Apple Distribution identity in $keychain." >&2
  exit 1
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mobile_dir="$repo_root/apps/mobile"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/gmacko-ios.XXXXXX")"
# macOS runners share one workspace: never leave a generated project behind.
cleanup() {
  rm -rf "$work_dir" "$mobile_dir/ios"
}
trap cleanup EXIT

# The runner's launchd environment has no locale; CocoaPods crashes without UTF-8.
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
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
project="ios/$scheme.xcodeproj"

# App Store builds use the production push environment.
for entitlements in ios/*/*.entitlements; do
  if /usr/libexec/PlistBuddy -c "Print :aps-environment" "$entitlements" >/dev/null 2>&1; then
    /usr/libexec/PlistBuddy -c "Set :aps-environment production" "$entitlements"
  fi
done

# Pin every signed target to its freshly minted profile and the distribution identity.
bundle_ids="$(grep -o 'PRODUCT_BUNDLE_IDENTIFIER = [^;]*;' "$project/project.pbxproj" | sed 's/.*= //; s/[";]//g' | sort -u)"
profiles="$(node "$repo_root/scripts/gmacko-ios-profiles.ts" "$identity" $bundle_ids)"
echo "$profiles"
# The xcodeproj gem ships with Homebrew's CocoaPods; use its gems and Ruby.
pod_gems="$(brew --prefix cocoapods)/libexec"
GEM_HOME="$pod_gems" PROFILES="$profiles" TEAM="$APPLE_TEAM_ID" \
  "$(head -1 "$pod_gems/bin/pod" | sed 's/^#!//')" -e '
    require "xcodeproj"
    profiles = ENV.fetch("PROFILES").lines.to_h { |line| line.split }
    project = Xcodeproj::Project.open(ARGV[0])
    project.native_targets.each do |target|
      target.build_configurations.each do |config|
        uuid = profiles[config.build_settings["PRODUCT_BUNDLE_IDENTIFIER"]]
        next unless uuid
        config.build_settings["CODE_SIGN_STYLE"] = "Manual"
        config.build_settings["DEVELOPMENT_TEAM"] = ENV.fetch("TEAM")
        config.build_settings["CODE_SIGN_IDENTITY"] = "Apple Distribution"
        config.build_settings["PROVISIONING_PROFILE_SPECIFIER"] = uuid
      end
    end
    project.save
  ' "$project"

xcodebuild archive \
  -workspace "$workspace" \
  -scheme "$scheme" \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "$work_dir/$scheme.xcarchive" \
  OTHER_CODE_SIGN_FLAGS="--keychain $keychain"

profile_entries="$(while read -r bundle uuid; do
  printf '    <key>%s</key>\n    <string>%s</string>\n' "$bundle" "$uuid"
done <<<"$profiles")"
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
  <string>manual</string>
  <key>signingCertificate</key>
  <string>Apple Distribution</string>
  <key>teamID</key>
  <string>${APPLE_TEAM_ID}</string>
  <key>provisioningProfiles</key>
  <dict>
${profile_entries}
  </dict>
  <key>manageAppVersionAndBuildNumber</key>
  <false/>
</dict>
</plist>
PLIST

xcodebuild -exportArchive \
  -archivePath "$work_dir/$scheme.xcarchive" \
  -exportOptionsPlist "$work_dir/ExportOptions.plist" \
  -exportPath "$work_dir/export" \
  -authenticationKeyPath "$APPLE_API_KEY_PATH" \
  -authenticationKeyID "$APPLE_API_KEY_ID" \
  -authenticationKeyIssuerID "$APPLE_API_ISSUER"

echo "Uploaded com.gmacko.t3code build $BUILD_NUMBER to App Store Connect."
