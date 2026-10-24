#!/bin/sh
# Removes the per-user install made by install.sh. Logins and chats in ~/.config/Vibecoder are kept.
PREFIX="${PREFIX:-$HOME/.local}"
pkill -f "$PREFIX/share/vibecoder/.*/server/vibecode-server" 2>/dev/null || true
rm -rf "$PREFIX/share/vibecoder" "$PREFIX/bin/vibecoder" "$PREFIX/share/applications/vibecoder.desktop" "$PREFIX/share/icons/hicolor/512x512/apps/vibecoder.png"
echo "Vibecoder removed. Your data stays in ~/.config/Vibecoder (delete that folder to start from scratch)."
