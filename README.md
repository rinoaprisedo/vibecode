# Vibecoder

IDE sederhana untuk macOS: file explorer, editor, git, terminal, dan **chat dengan Claude yang bisa mengedit kode** (agentic), semuanya dalam satu jendela. Bisa membuka beberapa folder project sekaligus, dengan sesi chat terpisah per project.

## Fitur

- **Multi-project**: banyak folder terbuka bersamaan, tiap project punya sesi chat, git, dan terminal sendiri.
- **Chat Claude (agentic)**: tab chat paralel, mode Manual / Edit / Plan / Auto, pilih model dan *effort*, tempel atau seret gambar, balasan tampil dengan markdown dan kode berwarna, izin tool muncul sebagai kartu Allow/Deny.
- **Banyak akun Claude**: tiap sesi chat bisa memakai akun langganan yang berbeda. Akun yang sama tidak bisa ditambahkan dua kali.
- **Usage**: sisa kuota 5 jam dan 7 hari, plus isi *context window* sesi yang aktif.
- **Editor**: warna sintaks (Go, PHP, React/JSX, HTML, CSS, JS/TS, Python, dll.), cari di file, tema gelap dan terang.
- **Explorer**: klik kanan untuk file baru, folder baru, rename, cut/copy/paste, hapus (ke Trash), copy path.
- **Git**: stage, *commit all*, push, buat dan pindah branch.
- **Terminal** terintegrasi dan **Remote Control** (lihat dan balas dari app Claude di HP).
- Notifikasi dan bunyi saat balasan selesai atau saat butuh persetujuan.

## Memasang di Mac

Butuh **macOS 12 atau lebih baru**. Pilih file sesuai Mac Anda:

| File | Untuk |
|---|---|
| `Vibecoder-…-arm64.dmg` | Mac Apple Silicon (M1/M2/M3/M4) |
| `Vibecoder-…-universal.dmg` | Apple Silicon **dan** Intel (ukuran sekitar 2× lipat) |

1. Buka file `.dmg`.
2. Klik dua kali **Install Vibecoder.command**. Ia menyalin app ke *Applications*, membuang tanda karantina, lalu membuka Vibecoder.
   Kalau macOS menolak membuka file `.command` itu, klik kanan lalu **Open** (di macOS 15 ke atas: **System Settings → Privacy & Security → Open Anyway**).
3. Atau manual: seret **Vibecoder** ke *Applications*, lalu jalankan di Terminal:

   ```bash
   xattr -cr /Applications/Vibecoder.app
   open /Applications/Vibecoder.app
   ```

### Kenapa muncul "The application can't be opened"?

App ini ditandatangani *ad-hoc* dan belum *notarized* oleh Apple. File yang diunduh diberi tanda karantina, dan macOS menolak membukanya. Perintah `xattr -cr` hanya membuang tanda itu; isi app tidak diubah. Penyelesaian permanen butuh akun Apple Developer (berbayar) untuk Developer ID dan notarization.

Jika dialog yang muncul berbeda atau app tetap tidak terbuka, jalankan ini di Terminal dan lihat pesan error-nya:

```bash
/Applications/Vibecoder.app/Contents/MacOS/Vibecoder
```

## Mulai memakai

1. Buka Vibecoder, klik **Add folder**, pilih folder project. Folder yang pernah dibuka tersimpan dan muncul lagi di peluncuran berikutnya.
2. Saat pertama kali chat, pilih **Claude account with subscription** (atau Anthropic Console), buka tautan, lalu tempel kode yang muncul.
3. Mulai mengetik di kotak chat.

Data (login, riwayat chat, daftar folder) tersimpan di `~/Library/Application Support/Vibecode/`. Untuk mengatur ulang dari awal, tutup app lalu hapus folder itu.

## Pintasan keyboard

| Pintasan | Fungsi |
|---|---|
| `⌘P` | Cari dan buka file di project aktif |
| `⌘F` / `⌘G` / `⇧⌘G` | Cari di editor / berikutnya / sebelumnya |
| `⌘S` | Simpan file |
| ``Ctrl+` `` | Buka atau tutup terminal |
| `⇧Tab` (di kotak chat) | Ganti mode chat |
| `Enter` / `⇧Enter` | Kirim / baris baru di chat |
| `⌘C` `⌘X` `⌘V`, `Enter`, `Delete` (di explorer) | Copy, cut, paste, rename, hapus |

## Menjalankan dari source

Butuh [Bun](https://bun.sh) dan akun Claude.

```bash
bun install
bun run dev ~/path/ke/project      # server + UI di http://127.0.0.1:4747
```

Server hanya bisa dijangkau dari komputer ini dan memakai token acak per sesi.

## Membuat `.dmg`

```bash
./scripts/build-app.sh             # Apple Silicon -> build/macos/Vibecoder-<versi>-arm64.dmg
```

Versi universal membutuhkan biner Claude Code untuk Intel (versi yang sama dengan yang arm64):

```bash
npm pack @anthropic-ai/claude-agent-sdk-darwin-x64@<versi> && tar -xzf *.tgz
X64_CLAUDE=$PWD/package/claude ./scripts/build-universal.sh
```

## Membuat versi Windows (.exe)

Bisa dibuat dari Mac (cross-compile), butuh Bun, npm, dan python3:

```bash
./scripts/build-windows.sh         # -> build/windows/Vibecoder-Setup-<versi>-x64.exe
```

Hasilnya folder `Vibecoder/` berisi `Vibecoder.cmd` (klik dua kali), `server/vibecode-server.exe`, `web/`, dan `claude/claude.exe`. UI dibuka di jendela app Microsoft Edge (atau Chrome/Brave); menutup jendela menghentikan server. Data tersimpan di `%APPDATA%\Vibecode`. Terminal di Windows berbasis baris (PowerShell lewat pipe). Belum ditandatangani, jadi SmartScreen akan memberi peringatan.

## Linux (Arch dan lainnya)

Satu tarball untuk x86_64 dan aarch64. Build dari Mac atau Linux (cross-compile), butuh Bun, npm, dan python3:

```bash
./scripts/build-linux.sh           # -> build/linux/Vibecoder-<versi>-linux.tar.gz
```

Pengguna: ekstrak, lalu `./install.sh` (tanpa root; ke `~/.local/share/vibecoder`, perintah `vibecoder`, dan menu aplikasi, hanya build untuk CPU-nya yang disalin). `./bin/vibecoder` menjalankan tanpa memasang, `./uninstall.sh` menghapus.

**Arch:** di folder hasil ekstrak sudah ada `PKGBUILD`, jalankan `makepkg -si`. Dicoba di Arch asli (x86_64): paket terbentuk, terpasang, dan app berjalan; arm64 dicoba di Debian. Paket opsional: `zenity` (dialog folder), `libnotify` (notifikasi), `xdg-utils` (buka tautan), `chromium` atau browser Chromium lain (jendela app), `git`, `docker`.

UI dibuka di jendela app browser Chromium (`--app`); tanpa itu dibuka di browser bawaan dan server berhenti beberapa detik setelah tab terakhir ditutup. Data ada di `~/.config/Vibecoder`. Terminalnya penuh (PTY), seperti di Mac.

## Struktur

```
server/   server Bun: file, git, chat (Claude Agent SDK), terminal, akun, remote
web/      UI React + CodeMirror 6 + xterm.js
app/      pembungkus macOS (Swift + WebKit) yang menjalankan server
scripts/  skrip build .app / .dmg, installer Windows, tarball Linux
packaging/ file bantu Linux (launcher, install.sh) dan PKGBUILD untuk Arch
```
