#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ "$(uname -s)" != Darwin ]] || ! command -v xcodebuild >/dev/null; then
  echo "FAIL: iPhone device compilation requires macOS with Xcode/iPhoneOS SDK. No IPA created." >&2
  exit 1
fi
export EXPO_NO_DOTENV=1
export NODE_ENV=production
unset SKIP_BUNDLING
export FORCE_BUNDLING=1
npm run ios:prepare
(cd ios && pod install)
WORKSPACE="$(find ios -maxdepth 1 -name '*.xcworkspace' -print -quit)"
SCHEME="$(basename "$WORKSPACE" .xcworkspace)"
BUILD="$ROOT/validation-output/ios-device"
# Generic iOS DEVICE target, not Simulator. Signing is disabled so this can be
# re-signed by the user; Release build phase embeds JS/Hermes and image assets.
xcodebuild -workspace "$WORKSPACE" -scheme "$SCHEME" -configuration Release \
  -sdk iphoneos -destination 'generic/platform=iOS' -derivedDataPath "$BUILD" \
  ARCHS=arm64 ONLY_ACTIVE_ARCH=NO CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY='' build
APP="$(find "$BUILD/Build/Products/Release-iphoneos" -maxdepth 1 -name '*.app' -print -quit)"
[[ -n "$APP" && -d "$APP" ]] || { echo 'No real iPhone .app produced' >&2; exit 1; }
xcrun swift scripts/test-coreml-smoke.swift \
  modules/local-classification/ios/Resources/best.mlpackage docs/COREML_SMOKE_REFERENCE.json
python3 scripts/package-ios-ipa.py "$APP" "$HOME/Desktop/Salatiq-iOS-test.ipa"
python3 scripts/verify-ios-ipa.py "$HOME/Desktop/Salatiq-iOS-test.ipa"
