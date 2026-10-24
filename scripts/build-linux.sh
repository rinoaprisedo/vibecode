#!/usr/bin/env bash
# Cross-builds ONE Linux release tarball for both x86_64 and aarch64, from a Mac/Linux box:
#   ./scripts/build-linux.sh        ->  build/Vibecoder-<version>-linux.tar.gz
# The install script (and the launcher) pick the right build for the CPU. Includes a PKGBUILD for Arch.
# Needs bun, npm, python3; sips (macOS) or a ready build/Vibecoder-512.png for the icon.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${VERSION:-1.0.1}"
NAME="vibecoder-${VERSION}-linux"
OUT="build/linux/${NAME}"
TAR="build/Vibecoder-${VERSION}-linux.tar.gz"
SDK_VERSION="$(bun -e "console.log(require('./node_modules/@anthropic-ai/claude-agent-sdk/package.json').version)")"

echo "==> Icon"
if [ ! -f build/Vibecoder-512.png ]; then
  if command -v sips >/dev/null; then sips -z 512 512 Logo-Vibecoder.png --out build/Vibecoder-512.png >/dev/null; else cp Logo-Vibecoder.png build/Vibecoder-512.png; fi
fi

echo "==> UI bundle";     bun run build:web

rm -rf "$OUT"; mkdir -p "$OUT/bin" "$OUT/web/dist" "$OUT/share"
for ARCH in x64 arm64; do
  echo "==> linux-${ARCH}: Claude Code ${SDK_VERSION} + server"
  CLAUDE="build/linux-claude-${ARCH}/package/claude"
  if [ ! -f "$CLAUDE" ]; then
    rm -rf "build/linux-claude-${ARCH}"; mkdir -p "build/linux-claude-${ARCH}"
    (cd "build/linux-claude-${ARCH}" && npm pack "@anthropic-ai/claude-agent-sdk-linux-${ARCH}@${SDK_VERSION}" --silent && tar -xzf ./*.tgz)
  fi
  [ -f "$CLAUDE" ] || { echo "claude binary not found in the linux-${ARCH} package"; exit 1; }
  bun build --compile --target="bun-linux-${ARCH}" server/index.ts --outfile "build/vibecode-server-linux-${ARCH}"
  rm -f .*.bun-build
  mkdir -p "$OUT/${ARCH}/server" "$OUT/${ARCH}/claude"
  cp "build/vibecode-server-linux-${ARCH}" "$OUT/${ARCH}/server/vibecode-server"
  cp "$CLAUDE" "$OUT/${ARCH}/claude/claude"
  chmod +x "$OUT/${ARCH}/server/vibecode-server" "$OUT/${ARCH}/claude/claude"
done

echo "==> Assemble $OUT"
cp web/index.html web/loading.gif "$OUT/web/"
cp web/dist/main.js web/dist/main.css "$OUT/web/dist/"
cp packaging/linux/vibecoder "$OUT/bin/vibecoder"
cp packaging/linux/install.sh packaging/linux/uninstall.sh "$OUT/"
cp packaging/linux/vibecoder.desktop "$OUT/share/"
cp build/Vibecoder-512.png "$OUT/share/vibecoder.png"
sed -e "s|@VERSION@|$VERSION|" packaging/arch/PKGBUILD.in > "$OUT/PKGBUILD"
chmod +x "$OUT/bin/vibecoder" "$OUT/install.sh" "$OUT/uninstall.sh"
cat > "$OUT/README-Linux.txt" <<'TXT'
Vibecoder for Linux (x86_64 and aarch64 in one package)

Install (no root):   ./install.sh      -> ~/.local/share/vibecoder, `vibecoder` command + applications menu entry
Run without install: ./bin/vibecoder
Remove:              ./uninstall.sh
Arch Linux package:  makepkg -si       (uses the PKGBUILD in this folder)

Vibecoder opens in its own window using a Chromium-based browser (chromium, chrome, brave, edge, vivaldi). Without one it
opens your default browser and exits shortly after you close the tab.
Optional: zenity (folder picker), libnotify (notifications), xdg-utils (open links), git, docker.
  Arch:   sudo pacman -S zenity libnotify xdg-utils chromium git
  Debian: sudo apt install zenity libnotify-bin xdg-utils chromium git

Logins, chats and the folder list are kept in ~/.config/Vibecoder (delete it to start from scratch).
TXT

echo "==> Tarball"
rm -f "$TAR" build/Vibecoder-*-linux-x64.tar.gz build/Vibecoder-*-linux-arm64.tar.gz build/PKGBUILD
COPYFILE_DISABLE=1 tar --no-xattrs --no-mac-metadata -C build/linux -czf "$TAR" "$NAME" 2>/dev/null || COPYFILE_DISABLE=1 tar -C build/linux -czf "$TAR" "$NAME"
echo "Done: $TAR ($(du -h "$TAR" | cut -f1))  sha256 $(shasum -a 256 "$TAR" | cut -d' ' -f1)"
