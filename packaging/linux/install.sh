#!/bin/sh
# Per-user install (no root): copies Vibecoder to ~/.local/share/vibecoder, adds `vibecoder` to ~/.local/bin
# and a launcher entry to the applications menu. Remove it again with ./uninstall.sh.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
PREFIX="${PREFIX:-$HOME/.local}"
DEST="$PREFIX/share/vibecoder"

case "$(uname -m)" in
  x86_64|amd64) A=x64 ;;
  aarch64|arm64) A=arm64 ;;
  *) echo "Unsupported CPU $(uname -m): Vibecoder runs on x86_64 and aarch64."; exit 1 ;;
esac
pkill -f "$DEST/$A/server/vibecode-server" 2>/dev/null || true
rm -rf "$DEST"; mkdir -p "$DEST" "$PREFIX/bin" "$PREFIX/share/applications" "$PREFIX/share/icons/hicolor/512x512/apps"
cp -a "$HERE/bin" "$HERE/web" "$HERE/share" "$HERE/$A" "$DEST/"   # only the build for this CPU
chmod +x "$DEST/bin/vibecoder" "$DEST/$A/server/vibecode-server" "$DEST/$A/claude/claude"
ln -sf "$DEST/bin/vibecoder" "$PREFIX/bin/vibecoder"
cp "$HERE/share/vibecoder.png" "$PREFIX/share/icons/hicolor/512x512/apps/vibecoder.png"
sed -e "s|@EXEC@|$DEST/bin/vibecoder|" -e "s|@ICON@|vibecoder|" "$HERE/share/vibecoder.desktop" > "$PREFIX/share/applications/vibecoder.desktop"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$PREFIX/share/applications" 2>/dev/null || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q "$PREFIX/share/icons/hicolor" 2>/dev/null || true

echo "Vibecoder installed in $DEST"
echo "Start it from the applications menu, or run: vibecoder"
case ":$PATH:" in *":$PREFIX/bin:"*) ;; *) echo "Note: $PREFIX/bin is not in your PATH yet; use the menu entry or $DEST/bin/vibecoder";; esac
echo
echo "Optional helpers (Arch): sudo pacman -S zenity libnotify xdg-utils chromium git"
