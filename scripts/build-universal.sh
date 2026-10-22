#!/usr/bin/env bash
# Builds build/universal/Vibecode.app and build/Vibecode-<version>-universal.dmg: one app that runs on Apple Silicon
# and Intel Macs. The Swift launcher is a fat binary; the Bun server and Claude Code ship once per CPU type.
#
# Needs the Intel Claude Code binary (same version as the arm64 one), for example:
#   npm pack @anthropic-ai/claude-agent-sdk-darwin-x64@<version>  &&  tar -xzf *.tgz
#   X64_CLAUDE=/path/to/package/claude ./scripts/build-universal.sh
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${VERSION:-0.1.0}"
ARM_CLAUDE="node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude"
X64_CLAUDE="${X64_CLAUDE:?set X64_CLAUDE to the Intel Claude Code binary}"
OUT="build/universal"
APP="$OUT/Vibecode.app"
DMG="build/Vibecode-${VERSION}-universal.dmg"

[ -x "$ARM_CLAUDE" ] || { echo "missing $ARM_CLAUDE (run: bun install)"; exit 1; }
[ -x "$X64_CLAUDE" ] || { echo "missing $X64_CLAUDE"; exit 1; }
file "$X64_CLAUDE" | grep -q x86_64 || { echo "$X64_CLAUDE is not an x86_64 binary"; exit 1; }

echo "==> UI bundle";         bun run build:web
rm -rf "$OUT"; mkdir -p "$OUT"
echo "==> Servers (arm64 + x64)"
bun build --compile --target=bun-darwin-arm64 server/index.ts --outfile "$OUT/vibecode-server-arm64"
bun build --compile --target=bun-darwin-x64   server/index.ts --outfile "$OUT/vibecode-server-x64"
rm -f .*.bun-build
echo "==> Launcher (arm64 + x86_64, one fat binary)"
swiftc -O app/Launcher.swift -target arm64-apple-macos12  -o "$OUT/launcher-arm64" -framework Cocoa -framework WebKit
swiftc -O app/Launcher.swift -target x86_64-apple-macos12 -o "$OUT/launcher-x64"   -framework Cocoa -framework WebKit
lipo -create "$OUT/launcher-arm64" "$OUT/launcher-x64" -output "$OUT/launcher"
echo "==> Icon";              python3 scripts/make-icon.py "$OUT/Vibecode.icns"

echo "==> Assemble $APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/server" "$APP/Contents/Resources/web/dist" "$APP/Contents/Resources/claude"
cp "$OUT/launcher"                "$APP/Contents/MacOS/Vibecode"
cp "$OUT/vibecode-server-arm64"   "$APP/Contents/Resources/server/"
cp "$OUT/vibecode-server-x64"     "$APP/Contents/Resources/server/"
cp "$ARM_CLAUDE"                  "$APP/Contents/Resources/claude/claude-arm64"
cp "$X64_CLAUDE"                  "$APP/Contents/Resources/claude/claude-x64"
cp web/index.html web/loading.gif "$APP/Contents/Resources/web/"
cp web/dist/main.js web/dist/main.css "$APP/Contents/Resources/web/dist/"
cp "$OUT/Vibecode.icns"           "$APP/Contents/Resources/Vibecode.icns"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Vibecode</string>
  <key>CFBundleDisplayName</key><string>Vibecode</string>
  <key>CFBundleIdentifier</key><string>com.vibecode.app</string>
  <key>CFBundleExecutable</key><string>Vibecode</string>
  <key>CFBundleIconFile</key><string>Vibecode</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.developer-tools</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST

echo "==> Sign (ad-hoc)"
for f in "$APP"/Contents/Resources/claude/claude-* "$APP"/Contents/Resources/server/vibecode-server-*; do codesign --force -s - "$f"; done
codesign --force -s - "$APP"
codesign --verify --verbose=1 "$APP"

echo "==> DMG"
STAGE="$OUT/dmg"; rm -rf "$STAGE" "$DMG"; mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"; ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "Vibecode" -srcfolder "$STAGE" -ov -format UDZO -imagekey zlib-level=9 "$DMG" >/dev/null
rm -rf "$STAGE"
echo "Done: $DMG ($(du -h "$DMG" | cut -f1))"
