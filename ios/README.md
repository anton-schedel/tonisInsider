# TonInsider for iOS

The native app (SwiftUI, iOS 27). Design: `docs/superpowers/specs/2026-11-03-ios-app-design.md`.

## Setup

1. Xcode 27 with your Apple account signed in (Settings → Accounts).
2. `cp Config/Local.xcconfig.example Config/Local.xcconfig` and fill in:
   - `DEVELOPMENT_TEAM`: your team id (the free Personal Team works for your own iPhone).
   - `BUNDLE_ID_PREFIX`: e.g. `de.yourname` (must be unique per team).
   - `SITE_URL`: the site, written `https:/$()/host` (`//` starts a comment in xcconfig files).
   The file is git-ignored: the repo is public.
3. `brew install xcodegen`, then `cd ios && xcodegen generate` (the `.xcodeproj` is generated, not committed).

## Commands

`DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer` if `xcode-select` points at the Command Line Tools.

- Tests: `xcodebuild test -scheme TonInsider -destination 'platform=iOS Simulator,name=<an iOS 27 simulator>'`
- iPhone: `xcodebuild -scheme TonInsider -destination 'platform=iOS,name=<your iPhone>' -allowProvisioningUpdates -derivedDataPath build build`,
  then `xcrun devicectl device install app --device <id> build/Build/Products/Debug-iphoneos/TonInsider.app`.
  First time: trust the developer on the iPhone (Settings → General → VPN & Device Management).
  Builds signed with a free Personal Team expire after 7 days.
