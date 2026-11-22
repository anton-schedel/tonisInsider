#!/bin/bash
# Archives the app and uploads it to TestFlight, signed and sent with an App Store Connect API key (no Xcode login).
# Account details stay out of the repo, in ios/Config/TestFlight.env (git-ignored):
#   TEAM_ID=…            the developer team's id
#   BUNDLE_ID_PREFIX=…   so the bundle id is "<prefix>.toninsider", as registered for the app
#   ASC_KEY_ID=…  ASC_ISSUER_ID=…  ASC_KEY_PATH=/path/to/AuthKey_….p8
# The archive is built unsigned; the export signs it for the App Store (an App Store profile needs no registered
# device, a development one would).
# Each upload gets a new build number (UTC yymmddHHMM). Builds expire after 90 days on TestFlight.
set -euo pipefail
cd "$(dirname "$0")/.."
source Config/TestFlight.env
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
XCODEGEN="$(command -v xcodegen || echo /opt/homebrew/bin/xcodegen)"
BUILD="$(date -u +%y%m%d%H%M)"
ARCHIVE="build/testflight/TonInsider.xcarchive"
AUTH=(-allowProvisioningUpdates -authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")

"$XCODEGEN" generate --quiet
rm -rf build/testflight && mkdir -p build/testflight
xcodebuild archive -project TonInsider.xcodeproj -scheme TonInsider -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" -derivedDataPath build \
  DEVELOPMENT_TEAM="$TEAM_ID" BUNDLE_ID_PREFIX="$BUNDLE_ID_PREFIX" CURRENT_PROJECT_VERSION="$BUILD" \
  CODE_SIGNING_ALLOWED=NO

cat > build/testflight/ExportOptions.plist <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>$TEAM_ID</string>
  <key>signingStyle</key><string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
PLIST
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportOptionsPlist build/testflight/ExportOptions.plist \
  -exportPath build/testflight/export "${AUTH[@]}"
echo "Uploaded build $BUILD."
