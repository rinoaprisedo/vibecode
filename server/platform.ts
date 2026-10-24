import { existsSync } from "node:fs";
import { join } from "node:path";

// Platform helpers for Windows and Linux. macOS keeps its original code paths (osascript, afplay, open, ...) at each
// call site; everything else goes through the generic functions at the bottom of this file.
export const isWin = process.platform === "win32";
export const isLinux = process.platform === "linux";
export const isMac = process.platform === "darwin";

const ps = (script: string, ...args: string[]) =>
  Bun.spawn(["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script, ...args],
    { stdout: "pipe", stderr: "pipe", stdin: "ignore", windowsHide: true } as any);

/** Open a URL in the default browser. */
export function openUrl(url: string) {
  if (isWin) Bun.spawn(["rundll32", "url.dll,FileProtocolHandler", url], { stdio: ["ignore", "ignore", "ignore"], windowsHide: true } as any);
  else if (isLinux) { try { Bun.spawn(["xdg-open", url], { stdio: ["ignore", "ignore", "ignore"] }); } catch { /* no xdg-utils: the URL is in the log */ } }
  else Bun.spawn(["open", url]);
}

// ---- Linux ----
/** First executable called `name` on PATH (plus the usual extra dirs), or null. */
export function which(name: string): string | null {
  const dirs = [...(process.env.PATH ?? "").split(":").filter(Boolean), "/usr/bin", "/usr/local/bin", "/bin"];
  for (const d of dirs) { const f = join(d, name); if (existsSync(f)) return f; }
  return null;
}
const quiet = { stdout: "ignore", stderr: "ignore", stdin: "ignore" } as const;

async function linuxPickFolder(prompt: string): Promise<string | null> {
  const z = which("zenity"), k = which("kdialog");
  const argv = z ? [z, "--file-selection", "--directory", `--title=${prompt}`]
    : k ? [k, "--getexistingdirectory", process.env.HOME ?? "/", "--title", prompt]
    : null;
  if (!argv) throw new Error("No folder dialog found. Install zenity (Arch: pacman -S zenity) or kdialog, or type the path instead.");
  const p = Bun.spawn(argv, { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
  const out = (await new Response(p.stdout as ReadableStream).text()).trim();
  return (await p.exited) === 0 && out ? out : null; // non-zero = cancelled
}

/** Move to the trash following the freedesktop.org spec: gio / trash-cli / kde when present, else a built-in move. */
async function linuxTrash(abs: string) {
  const tries: string[][] = [];
  const gio = which("gio"), tp = which("trash-put"), kio = which("kioclient6") ?? which("kioclient5") ?? which("kioclient");
  if (gio) tries.push([gio, "trash", abs]);
  if (tp) tries.push([tp, abs]);
  if (kio) tries.push([kio, "move", abs, "trash:/"]);
  for (const argv of tries) { if ((await Bun.spawn(argv, quiet).exited) === 0) return; }
  // Built-in fallback: ~/.local/share/Trash with a .trashinfo record (same filesystem only).
  const { mkdir, rename, writeFile, stat } = await import("node:fs/promises");
  const { basename } = await import("node:path");
  const home = process.env.HOME ?? "";
  const base = join(process.env.XDG_DATA_HOME ?? join(home, ".local", "share"), "Trash");
  await mkdir(join(base, "files"), { recursive: true }); await mkdir(join(base, "info"), { recursive: true });
  const name = basename(abs);
  let target = name, n = 1;
  while (await stat(join(base, "files", target)).then(() => true, () => false)) target = `${name}.${n++}`;
  const info = `[Trash Info]\nPath=${encodeURI(abs)}\nDeletionDate=${new Date().toISOString().slice(0, 19)}\n`;
  await writeFile(join(base, "info", target + ".trashinfo"), info);
  try { await rename(abs, join(base, "files", target)); }
  catch (e: any) {
    await Bun.spawn(["rm", "-f", join(base, "info", target + ".trashinfo")], quiet).exited;
    throw new Error(e?.code === "EXDEV" ? "Couldn't move to the Trash (different disk). Install glib2 (gio) or trash-cli." : `Couldn't move to the Trash: ${e?.message ?? e}`);
  }
}

function linuxBeep(kind: "Asterisk" | "Exclamation") {
  const id = kind === "Exclamation" ? "message" : "complete";
  const file = ["/usr/share/sounds/freedesktop/stereo", "/usr/share/sounds/ocean/stereo"].map((d) => join(d, `${id}.oga`)).find((f) => existsSync(f));
  const pa = which("paplay"), pw = which("pw-play"), ca = which("canberra-gtk-play");
  if (file && pa) Bun.spawn([pa, file], quiet);
  else if (file && pw) Bun.spawn([pw, file], quiet);
  else if (ca) Bun.spawn([ca, "-i", id], quiet);
}

function linuxNotify(title: string, body: string) {
  const n = which("notify-send");
  if (n) Bun.spawn([n, "-a", "Vibecoder", "--", title, body], quiet);
}

/** Native folder picker. Resolves null when the user cancels. */
export async function winPickFolder(prompt: string): Promise<string | null> {
  const p = ps(
    "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; " +
    "$d.Description = $args[0]; $d.ShowNewFolderButton = $true; " +
    "$f = New-Object System.Windows.Forms.Form; $f.TopMost = $true; " +
    "if ($d.ShowDialog($f) -eq 'OK') { [Console]::Out.Write($d.SelectedPath) } else { exit 1 }",
    prompt,
  );
  const out = (await new Response(p.stdout as ReadableStream).text()).trim();
  return (await p.exited) === 0 && out ? out : null;
}

/** Send a file or folder to the Recycle Bin (recoverable). */
export async function winTrash(abs: string) {
  const p = ps(
    "Add-Type -AssemblyName Microsoft.VisualBasic; $p = $args[0]; " +
    "if (Test-Path -LiteralPath $p -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin') } " +
    "else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin') }",
    abs,
  );
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; p.kill(); }, 15_000);
  const err = await new Response(p.stderr as ReadableStream).text();
  const code = await p.exited;
  clearTimeout(timer);
  if (code !== 0) throw new Error("Couldn't move to the Recycle Bin" + (timedOut ? " (timed out)" : err.trim() ? `: ${err.trim()}` : ""));
}

/** Short system sound (stands in for afplay). */
export function winBeep(kind: "Asterisk" | "Exclamation" = "Asterisk") {
  ps(`[System.Media.SystemSounds]::${kind}.Play(); Start-Sleep -Milliseconds 800`);
}

/** Toast-like balloon notification (stands in for osascript's display notification). Text goes in as arguments. */
export function winNotify(title: string, body: string) {
  ps(
    "Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; " +
    "$n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true; " +
    "$n.ShowBalloonTip(5000, $args[0], $args[1], 'Info'); Start-Sleep -Seconds 6; $n.Dispose()",
    title, body,
  );
}

/** The default shell for the integrated terminal. */
export function winShell(): string[] {
  const pwsh = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return existsSync(pwsh) ? [pwsh, "-NoLogo"] : [process.env.ComSpec ?? "cmd.exe"];
}

/** Find a Chromium-based browser that can run as a chrome-less app window (Edge ships with Windows 10/11). */
export function findAppBrowser(): string | null {
  if (isLinux) {
    for (const n of ["chromium", "chromium-browser", "google-chrome-stable", "google-chrome", "brave", "brave-browser", "microsoft-edge-stable", "vivaldi", "vivaldi-stable"]) {
      const f = which(n); if (f) return f;
    }
    return null;
  }
  const roots = [process.env["ProgramFiles(x86)"], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean) as string[];
  const rel = [
    "Microsoft\\Edge\\Application\\msedge.exe",
    "Google\\Chrome\\Application\\chrome.exe",
    "BraveSoftware\\Brave-Browser\\Application\\brave.exe",
  ];
  for (const r of rel) for (const root of roots) { const f = join(root, r); if (existsSync(f)) return f; }
  return null;
}

// ---- Generic entry points (Windows + Linux; callers keep their own macOS branch) ----
export const pickFolderNative = (prompt: string) => (isWin ? winPickFolder(prompt) : linuxPickFolder(prompt));
export const trashItem = (abs: string) => (isWin ? winTrash(abs) : linuxTrash(abs));
export const playSound = (kind: "Asterisk" | "Exclamation" = "Asterisk") => { if (isWin) winBeep(kind); else linuxBeep(kind); };
export const notify = (title: string, body: string) => { if (isWin) winNotify(title, body); else linuxNotify(title, body); };
