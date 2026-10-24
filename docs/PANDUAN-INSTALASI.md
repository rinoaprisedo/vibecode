# Panduan Instalasi Vibecoder

Vibecoder adalah aplikasi untuk menulis kode dengan bantuan Claude (AI). Panduan ini untuk pemula. Pilih bagian sesuai komputermu:

- [Linux (Arch dan distro lain)](#linux)
- [Windows](#windows)
- [Mac](#mac)
- [Login Claude (semua sistem)](#login-claude-pertama-kali)

**Yang kamu butuhkan:** akun Claude (langganan Claude Pro/Max, atau akun Anthropic Console) dan koneksi internet. Tidak ada program lain yang wajib dipasang.

---

## Linux

Contoh perintah di bawah memakai **Arch Linux**. Di distro lain langkahnya sama, hanya perintah memasang paket tambahan yang berbeda.

### Langkah 1. Unduh file

Unduh file **`Vibecoder-1.0.2-linux.tar.gz`** (sekitar 330 MB) dan simpan di folder **Downloads**. Satu file ini cocok untuk semua komputer Linux 64-bit (Intel/AMD maupun ARM).

### Langkah 2. Buka Terminal di folder Downloads

Buka aplikasi **Terminal**, lalu ketik perintah ini dan tekan **Enter**:

```bash
cd ~/Downloads
```

### Langkah 3. Ekstrak file

```bash
tar xzf Vibecoder-1.0.2-linux.tar.gz
cd vibecoder-1.0.2-linux
```

Perintah pertama membuka (mengekstrak) file, perintah kedua masuk ke foldernya. Prosesnya bisa memakan waktu setengah menit.

### Langkah 4. Pasang Vibecoder

```bash
./install.sh
```

Tidak perlu password dan tidak memerlukan akses administrator. Kalau berhasil, muncul tulisan:

```
Vibecoder installed in /home/namamu/.local/share/vibecoder
Start it from the applications menu, or run: vibecoder
```

### Langkah 5. Pasang program pendukung (disarankan)

Program ini tidak wajib, tapi tanpa mereka beberapa fitur tidak jalan. Jalankan **satu perintah** ini (akan diminta password):

```bash
sudo pacman -S --needed zenity libnotify xdg-utils chromium git
```

| Program | Gunanya | Kalau tidak dipasang |
|---|---|---|
| `chromium` | Membuat jendela Vibecoder tampil seperti aplikasi biasa | Vibecoder terbuka sebagai tab di browser |
| `zenity` | Kotak dialog untuk memilih folder project | Tombol "Open folder" menampilkan pesan error |
| `git` | Fitur Git (commit, push) | Fitur Git tidak jalan |
| `libnotify` | Notifikasi saat Claude selesai menjawab | Tidak ada notifikasi |
| `xdg-utils` | Membuka link di browser | Link tidak terbuka otomatis |

Browser Chromium lain, seperti Google Chrome, Brave, atau Vivaldi, juga bisa menggantikan `chromium`.

### Langkah 6. Jalankan Vibecoder

Cari **Vibecoder** di menu aplikasi, lalu klik. Atau, dari Terminal:

```bash
vibecoder
```

Lanjut ke [Login Claude](#login-claude-pertama-kali).

### Alternatif untuk pengguna Arch: pasang sebagai paket

Di folder `vibecoder-1.0.2-linux` yang sama, jalankan:

```bash
makepkg -si
```

Hasilnya terpasang untuk seluruh sistem (di `/opt/vibecoder`), dan bisa dihapus dengan `sudo pacman -R vibecoder-bin`.

### Kalau ada masalah di Linux

| Masalah | Penyelesaian |
|---|---|
| `Permission denied` saat `./install.sh` | Jalankan `chmod +x install.sh`, lalu ulangi |
| `command not found: vibecoder` | Tutup dan buka lagi Terminal, atau jalankan `~/.local/share/vibecoder/bin/vibecoder` |
| Vibecoder tidak muncul di menu aplikasi | Keluar dari sesi (logout) lalu masuk lagi |
| Vibecoder terbuka di tab browser, bukan jendela sendiri | Pasang `chromium` (Langkah 5). Menutup tab itu akan menghentikan Vibecoder sendiri beberapa detik kemudian |
| Tombol "Open folder" muncul error | Pasang `zenity` (Langkah 5), atau ketik alamat folder secara manual |

### Menghapus Vibecoder (Linux)

Dari folder `vibecoder-1.0.2-linux`:

```bash
./uninstall.sh
```

Login dan riwayat chat tetap tersimpan di `~/.config/Vibecoder`. Hapus folder itu kalau ingin benar-benar bersih.

---

## Windows

### Langkah 1. Unduh installer

Unduh **`Vibecoder-Setup-1.0.1-x64.exe`** (sekitar 130 MB).

### Langkah 2. Jalankan installer

Klik dua kali file tersebut. Akan muncul peringatan biru **"Windows protected your PC"** karena aplikasi ini belum ditandatangani. Ini normal:

1. Klik **More info**.
2. Klik **Run anyway**.

### Langkah 3. Ikuti penunjuk

Klik **Next**, **Install**, lalu **Finish**. Tidak perlu hak administrator. Pilih "Start Vibecoder" di akhir untuk langsung membukanya.

### Langkah 4. Pasang Git (kalau mau memakai fitur Git)

Unduh **Git for Windows** dari https://git-scm.com lalu pasang dengan pilihan bawaan.

### Membuka Vibecoder lagi

Klik ikon **Vibecoder** di Desktop atau di Start Menu. Lanjut ke [Login Claude](#login-claude-pertama-kali).

### Menghapus Vibecoder (Windows)

Buka **Settings → Apps → Installed apps**, cari **Vibecoder**, lalu klik **Uninstall**. Login dan riwayat chat tetap tersimpan di `%APPDATA%\Vibecoder`.

---

## Mac

### Langkah 1. Unduh file yang sesuai

| Mac kamu | File |
|---|---|
| Apple Silicon (M1, M2, M3, M4) | `Vibecoder-1.0.1-arm64.dmg` |
| Tidak yakin, atau Mac Intel | `Vibecoder-1.0.1-universal.dmg` (ukurannya sekitar dua kali lipat) |

Untuk mengecek: klik logo Apple di pojok kiri atas, lalu **About This Mac**. Kalau tertulis "Chip Apple M…", itu Apple Silicon.

### Langkah 2. Buka file dmg

Klik dua kali file `.dmg` yang sudah diunduh.

### Langkah 3. Jalankan installer

Klik dua kali **Install Vibecoder.command**. Ia menyalin aplikasi ke folder *Applications* dan langsung membukanya.

**Kalau macOS menolak membuka file itu:**
- Klik kanan file tersebut, lalu pilih **Open**, lalu **Open** lagi.
- Di macOS 15 ke atas: buka **System Settings → Privacy & Security**, gulir ke bawah, lalu klik **Open Anyway**.

Lanjut ke [Login Claude](#login-claude-pertama-kali).

### Menghapus Vibecoder (Mac)

Seret **Vibecoder** dari folder *Applications* ke Trash. Login dan riwayat chat tersimpan di `~/Library/Application Support/Vibecode`.

---

## Login Claude (pertama kali)

Langkah ini sama di semua sistem:

1. Buka Vibecoder, lalu klik **Add folder** atau **Create project**.
2. Pilih folder project yang ingin dikerjakan. Folder yang pernah dibuka akan muncul lagi di lain waktu.
3. Di kotak chat di bawah, klik **Claude account with subscription** (untuk langganan Claude Pro/Max). Pilih **Anthropic Console** kalau memakai akun API.
4. Browser akan membuka halaman login Anthropic. Kalau tidak terbuka sendiri, klik link yang muncul di Vibecoder.
5. Login, klik izinkan, lalu **salin kode** yang tampil.
6. Kembali ke Vibecoder, **tempel kode** itu di kolom yang tersedia.
7. Selesai. Ketik pertanyaan atau permintaan di kotak chat dan tekan **Enter**.

Satu akun Claude yang sama tidak bisa ditambahkan dua kali. Untuk menambah akun lain, buka **Settings** (ikon roda gigi di pojok kanan atas) lalu **Add account**.

### Beberapa fitur yang berguna

| Aksi | Cara |
|---|---|
| Kirim pesan | **Enter** (baris baru: **Shift+Enter**) |
| Pindah kursor ke kotak chat | **Alt+C** (di Mac: **⌥C**) |
| Buka tab chat baru | **Alt+N** (di Mac: **⌥N**) |
| Cari dan buka file | **Ctrl+P** (di Mac: **⌘P**) |
| Ubah shortcut | **Settings → Keyboard shortcuts** |

### Butuh bantuan?

Kalau Vibecoder tidak mau terbuka atau ada pesan error, catat tulisan error-nya (atau ambil screenshot) dan kirim ke pengembang. Log ada di:

- Linux: `~/.config/Vibecoder`
- Windows: `%APPDATA%\Vibecoder\server.log`
- Mac: `~/Library/Application Support/Vibecode/server.log`
