#!/bin/bash
# Double-click from the disk image: copies Vibecode to Applications, removes the download quarantine flag
# (the app is not notarized, so macOS would otherwise refuse to open it) and launches it.
cd "$(dirname "$0")" || exit 1
APP="Vibecode.app"
DEST="${INSTALL_DIR:-/Applications}"

echo "Memasang Vibecode ke $DEST ..."
[ -d "$APP" ] || { echo "Vibecode.app tidak ditemukan di sebelah skrip ini."; read -r -p "Tekan Enter untuk menutup."; exit 1; }
rm -rf "$DEST/$APP"
cp -R "$APP" "$DEST/" || { echo "Gagal menyalin ke $DEST."; read -r -p "Tekan Enter untuk menutup."; exit 1; }
xattr -cr "$DEST/$APP"
echo "Selesai."
[ -n "$NO_OPEN" ] || open "$DEST/$APP"
