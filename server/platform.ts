import { existsSync } from "node:fs";
import { join } from "node:path";

// Windows-only helpers. Every caller keeps its original macOS/Linux code path and only branches here on win32,
// so nothing changes on the Mac.
export const isWin = process.platform === "win32";

const ps = (script: string, ...args: string[]) =>
  Bun.spawn(["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script, ...args],
    { stdout: "pipe", stderr: "pipe", stdin: "ignore", windowsHide: true } as any);

/** Open a URL in the default browser. */
export function openUrl(url: string) {
  if (isWin) Bun.spawn(["rundll32", "url.dll,FileProtocolHandler", url], { stdio: ["ignore", "ignore", "ignore"], windowsHide: true } as any);
  else Bun.spawn(["open", url]);
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
  const roots = [process.env["ProgramFiles(x86)"], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean) as string[];
  const rel = [
    "Microsoft\\Edge\\Application\\msedge.exe",
    "Google\\Chrome\\Application\\chrome.exe",
    "BraveSoftware\\Brave-Browser\\Application\\brave.exe",
  ];
  for (const r of rel) for (const root of roots) { const f = join(root, r); if (existsSync(f)) return f; }
  return null;
}
