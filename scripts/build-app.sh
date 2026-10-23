#!/usr/bin/env bash
# Builds build/Vibecoder.app and build/Vibecoder-<version>.dmg (Apple Silicon, ad-hoc signed).
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${VERSION:-1.0.1}"
ARCH="$(uname -m)"
CLAUDE_BIN="node_modules/@anthropic-ai/claude-agent-sdk-darwin-${ARCH/x86_64/x64}/claude"
APP="build/Vibecoder.app"
DMG="build/Vibecoder-${VERSION}-${ARCH}.dmg"

[ -x "$CLAUDE_BIN" ] || { echo "Claude Code binary not found at $CLAUDE_BIN (run: bun install)"; exit 1; }

echo "==> UI bundle";      bun run build:web
echo "==> Server binary";  bun build --compile server/index.ts --outfile build/vibecode-server
rm -f .*.bun-build
echo "==> Launcher";       swiftc -O app/Launcher.swift -o build/Vibecoder-launcher -framework Cocoa -framework WebKit
echo "==> Icon";           [ -f build/Vibecoder.icns ] || python3 scripts/make-icon.py build/Vibecoder.icns   # keep the existing icon (needs Pillow to redraw)

echo "==> Assemble $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/server" "$APP/Contents/Resources/web/dist" "$APP/Contents/Resources/claude"
cp build/Vibecoder-launcher        "$APP/Contents/MacOS/Vibecoder"
cp build/vibecode-server          "$APP/Contents/Resources/server/vibecode-server"
cp "$CLAUDE_BIN"                  "$APP/Contents/Resources/claude/claude"
cp web/index.html web/loading.gif "$APP/Contents/Resources/web/"
cp web/dist/main.js web/dist/main.css "$APP/Contents/Resources/web/dist/"
cp build/Vibecoder.icns            "$APP/Contents/Resources/Vibecoder.icns"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Vibecoder</string>
  <key>CFBundleDisplayName</key><string>Vibecoder</string>
  <key>CFBundleIdentifier</key><string>com.vibecode.app</string>
  <key>CFBundleExecutable</key><string>Vibecoder</string>
  <key>CFBundleIconFile</key><string>Vibecoder</string>
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
codesign --force -s - "$APP/Contents/Resources/claude/claude"
codesign --force -s - "$APP/Contents/Resources/server/vibecode-server"
codesign --force -s - "$APP"
codesign --verify --verbose=1 "$APP"

echo "==> DMG"
STAGE="build/dmg"
rm -rf "$STAGE" "$DMG"; mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
cp scripts/Install-Vibecoder.command "$STAGE/Install Vibecoder.command"; chmod +x "$STAGE/Install Vibecoder.command"
hdiutil create -volname "Vibecoder" -srcfolder "$STAGE" -ov -format UDZO -imagekey zlib-level=9 "$DMG" >/dev/null
rm -rf "$STAGE"
echo "Done: $DMG ($(du -h "$DMG" | cut -f1))"
