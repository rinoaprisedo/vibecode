#!/usr/bin/env bash
# Cross-builds the Windows (x64) installer from a Mac/Linux box: build/Vibecoder-Setup-<version>-x64.exe
# (PORTABLE=1 also writes build/Vibecoder-<version>-win-x64.zip). Needs bun, npm, python3, makensis (brew install makensis)
# and (for the icon) sips on macOS or a ready build/Vibecoder.ico.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${VERSION:-1.0.1}"
OUT="build/windows/Vibecoder"
ZIP="build/Vibecoder-${VERSION}-win-x64.zip"
SDK_VERSION="$(node -p "require('./node_modules/@anthropic-ai/claude-agent-sdk/package.json').version" 2>/dev/null || bun -e "console.log(require('./node_modules/@anthropic-ai/claude-agent-sdk/package.json').version)")"

echo "==> Claude Code binary for Windows ($SDK_VERSION)"
CLAUDE_EXE="build/windows-claude/package/claude.exe"
if [ ! -f "$CLAUDE_EXE" ]; then
  rm -rf build/windows-claude; mkdir -p build/windows-claude
  (cd build/windows-claude && npm pack "@anthropic-ai/claude-agent-sdk-win32-x64@${SDK_VERSION}" --silent && tar -xzf ./*.tgz)
fi
[ -f "$CLAUDE_EXE" ] || { echo "claude.exe not found in the win32-x64 package"; exit 1; }

echo "==> Icon"
if [ ! -f build/Vibecoder.ico ]; then
  TMP="$(mktemp -d)"; sips -z 256 256 Logo-Vibecoder.png --out "$TMP/256.png" >/dev/null
  python3 - "$TMP/256.png" build/Vibecoder.ico <<'PY'
import struct, sys
png = open(sys.argv[1], "rb").read()
# single-image ICO with an embedded 256x256 PNG
open(sys.argv[2], "wb").write(struct.pack("<HHH", 0, 1, 1) + struct.pack("<BBBBHHII", 0, 0, 0, 0, 1, 32, len(png), 22) + png)
PY
  rm -rf "$TMP"
fi

echo "==> UI bundle";     bun run build:web
echo "==> Server (exe)"
# Exe icon/version metadata can only be embedded when bun runs on Windows itself.
META=(); case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) META=(--windows-icon=build/Vibecoder.ico --windows-title=Vibecoder --windows-description=Vibecoder --windows-version="${VERSION}.0");; esac
bun build --compile --target=bun-windows-x64 --windows-hide-console ${META[@]+"${META[@]}"} \
  server/index.ts --outfile build/vibecode-server.exe
rm -f .*.bun-build

echo "==> Assemble $OUT"
rm -rf "build/windows"; mkdir -p "$OUT/server" "$OUT/web/dist" "$OUT/claude"
cp build/vibecode-server.exe       "$OUT/server/vibecode-server.exe"
cp "$CLAUDE_EXE"                   "$OUT/claude/claude.exe"
cp web/index.html web/loading.gif  "$OUT/web/"
cp web/dist/main.js web/dist/main.css "$OUT/web/dist/"
cp build/Vibecoder.ico "$OUT/Vibecoder.ico"
# Double-click entry point at the top of the folder (the server exe opens its own window and has no console).
cat > "$OUT/Vibecoder.cmd" <<'CMD'
@echo off
start "" "%~dp0server\vibecode-server.exe"
CMD
cat > "$OUT/README-Windows.txt" <<'TXT'
Vibecoder for Windows (x64)

1. Extract this folder anywhere (e.g. C:\Users\<you>\Vibecoder). Do not run it from inside the zip.
2. Double-click Vibecoder.cmd (or server\vibecode-server.exe). Vibecoder opens in its own window using Microsoft Edge
   (already part of Windows 10/11); Chrome or Brave are used if Edge is missing.
3. Windows SmartScreen may warn about an unsigned app: choose "More info" > "Run anyway".
4. Git for Windows (https://git-scm.com) is needed for the Git features.

Your logins, chats and folder list are kept in %APPDATA%\Vibecode. Delete that folder to start from scratch.
Logs: %APPDATA%\Vibecode\server.log (if present).

The built-in terminal on Windows is line-based (PowerShell over pipes): commands and their output work, full-screen programs do not.
TXT

echo "==> Installer (NSIS)"
command -v makensis >/dev/null || { echo "makensis not found (brew install makensis)"; exit 1; }
SETUP="build/Vibecoder-Setup-${VERSION}-x64.exe"
rm -f "$SETUP"
# makensis aborts (bad_alloc) when no UTF-8 locale is set
LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 makensis -V2 -DVERSION="$VERSION" -DSRC="$PWD/$OUT" -DOUT="$PWD/$SETUP" scripts/installer.nsi
echo "Done: $SETUP ($(du -h "$SETUP" | cut -f1))"

# Optional portable zip (no installer): PORTABLE=1 ./scripts/build-windows.sh
if [ "${PORTABLE:-0}" = "1" ]; then
  rm -f "$ZIP"; (cd build/windows && zip -qr "../../$ZIP" Vibecoder)
  echo "Done: $ZIP ($(du -h "$ZIP" | cut -f1))"
fi
